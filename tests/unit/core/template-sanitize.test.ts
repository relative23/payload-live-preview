/**
 * Item templates are the page author's markup, so the sanitizer admits form
 * controls and media the rich-text policy refuses. Which ones is a list, and a
 * list nothing asserts is a list that decays: every entry here was removable
 * without a single test going red.
 *
 * These cases go through `sanitizeHtml` rather than reading the options back,
 * so they say what an author may write instead of restating the constant.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { sanitizeHtml, setSanitizerPolicy } from '@security/sanitizer';
import { templateSanitizeOptions } from '@core/template-sanitize';

const TEMPLATE = '<li>{{title}}</li>';

function clean(html: string, template = TEMPLATE): string {
  return sanitizeHtml(html, templateSanitizeOptions(template));
}

beforeEach(() => {
  setSanitizerPolicy('strict');
});

describe('template mode admits the form controls and media an author writes', () => {
  it.each([
    ['input', '<input>'],
    ['textarea', '<textarea></textarea>'],
    ['select', '<select></select>'],
    ['option', '<select><option>a</option></select>'],
    ['button', '<button>a</button>'],
    ['label', '<label>a</label>'],
    ['details', '<details>a</details>'],
    ['summary', '<details><summary>a</summary></details>'],
    ['dialog', '<dialog>a</dialog>'],
    ['video', '<video></video>'],
    ['audio', '<audio></audio>'],
    ['progress', '<progress></progress>'],
    ['meter', '<meter></meter>'],
  ])('keeps <%s>', (tag, markup) => {
    expect(clean(`<div>${markup}</div>`)).toContain(`<${tag}`);
  });

  it('still refuses what no template needs', () => {
    const html = clean('<div><script>x()</script><iframe></iframe><style>a{}</style></div>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<style');
  });
});

describe('template mode keeps the attributes those controls need', () => {
  it.each([
    ['type', '<input type="checkbox">', 'input'],
    ['name', '<input name="agree">', 'input'],
    ['placeholder', '<input placeholder="Name">', 'input'],
    ['open', '<details open>a</details>', 'details'],
    ['disabled', '<button disabled>a</button>', 'button'],
    ['readonly', '<input readonly>', 'input'],
    ['required', '<input required>', 'input'],
    ['checked', '<input type="checkbox" checked>', 'input'],
    ['selected', '<select><option selected>a</option></select>', 'option'],
    ['value', '<input value="v">', 'input'],
    ['min', '<input min="1">', 'input'],
    ['max', '<input max="9">', 'input'],
    ['step', '<input step="2">', 'input'],
    ['rows', '<textarea rows="3"></textarea>', 'textarea'],
    ['cols', '<textarea cols="4"></textarea>', 'textarea'],
    ['for', '<label for="x">a</label>', 'label'],
    ['controls', '<video controls></video>', 'video'],
    ['muted', '<video muted></video>', 'video'],
    ['loop', '<video loop></video>', 'video'],
    ['poster', '<video poster="/p.png"></video>', 'video'],
    ['src', '<video src="/v.mp4"></video>', 'video'],
  ])('keeps %s on <%s>', (attribute, markup, tag) => {
    const html = clean(`<div>${markup}</div>`);
    expect(html, `${attribute} was stripped from <${tag}>`).toContain(attribute);
  });

  it('strips an event handler and a style even in template mode', () => {
    const html = clean('<div><button onclick="x()" style="color:red">a</button></div>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('style=');
  });

  it('rejects an unsafe URL on an admitted attribute', () => {
    expect(clean('<div><video src="javascript:x()"></video></div>')).not.toContain('javascript:');
  });
});

describe('custom elements come from the template itself', () => {
  it('admits a custom element the template declares', () => {
    const html = clean('<div><my-widget>a</my-widget></div>', '<li><my-widget></my-widget></li>');
    expect(html).toContain('<my-widget');
  });

  it('does not admit one the template never mentions', () => {
    expect(clean('<div><other-widget>a</other-widget></div>')).not.toContain('<other-widget');
  });

  it('needs the hyphen: a bare name is not a custom element', () => {
    // The pattern requires at least one `-` group, which is what separates a
    // custom element from an unknown tag the sanitizer should drop.
    const html = clean('<div><mywidget>a</mywidget></div>', '<li><mywidget></mywidget></li>');
    expect(html).not.toContain('<mywidget');
  });

  it('admits a custom element with several hyphens, case-insensitively', () => {
    const html = clean('<div><My-Fancy-Widget>a</My-Fancy-Widget></div>', '<li><My-Fancy-Widget/></li>');
    expect(html).toContain('<my-fancy-widget');
  });
});

describe('options are memoised per template string', () => {
  it('returns the identical object for the same template', () => {
    const template = '<li data-x="1">{{title}}</li>';
    expect(templateSanitizeOptions(template)).toBe(templateSanitizeOptions(template));
  });

  it('returns different options for a template declaring another element', () => {
    const first = templateSanitizeOptions('<li><a-one></a-one></li>');
    const second = templateSanitizeOptions('<li><b-two></b-two></li>');
    expect(first).not.toBe(second);
    expect(first.additionalAllowedTags).toContain('a-one');
    expect(second.additionalAllowedTags).toContain('b-two');
    expect(first.additionalAllowedTags).not.toContain('b-two');
  });

  it('gives every admitted tag the same attribute list', () => {
    const options = templateSanitizeOptions('<li><c-three></c-three></li>');
    const attributes = options.additionalAllowedAttributes ?? {};
    expect(Object.keys(attributes)).toContain('c-three');
    expect(attributes['c-three']).toEqual(attributes['input']);
  });
});
