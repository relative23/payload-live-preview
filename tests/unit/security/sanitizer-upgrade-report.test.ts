import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeHtml, setSanitizerPolicy } from '@security/sanitizer';
import { resetDroppedAttributeReports } from '@security/sanitizer-report';

/**
 * The one behaviour change a 1.x project cannot see coming.
 *
 * `sanitizerPolicy` defaults to `'strict'` since 2.0; `'compat'` let `id`,
 * `name` and every `data-*` through. The difference only surfaces when a
 * binding writes markup, so an upgraded project loses its own hooks at the
 * moment an editor types — in the preview, silently. Measured on a real 1.8.1
 * consumer, where a `data-*` attribute driving a CSS selector vanished on the
 * first write. LP0409 is what says so.
 */

function warnings(html: string): string[] {
  const seen: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    seen.push(String(args[0]));
  });
  try {
    sanitizeHtml(html);
  } finally {
    spy.mockRestore();
  }
  return seen;
}

describe('LP0409', () => {
  beforeEach(() => {
    resetDroppedAttributeReports();
    setSanitizerPolicy('strict');
  });

  it('names the attribute and the policy that kept it', () => {
    const [message] = warnings('<div data-partner-scroll="">x</div>');

    expect(message).toContain('LP0409');
    expect(message).toContain('data-partner-scroll');
    expect(message).toContain("sanitizerPolicy: 'compat'");
    expect(message).toContain('allowedDataAttributes');
  });

  it('gives `id` and `name` their own reason, not the data-attribute one', () => {
    const messages = warnings('<div id="a" name="b">x</div>');

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toContain('clobbering');
      expect(message).not.toContain('allowedDataAttributes');
    }
  });

  it('does not offer `compat` for a binding attribute, which it would not fix', () => {
    // Re-admitting `data-payload-*` from CMS content is refused by design, so
    // pointing at a policy switch there would be advice that cannot be taken.
    const [message] = warnings('<div data-payload-field="title">x</div>');

    expect(message).toContain('refused by design');
    expect(message).not.toContain('allowedDataAttributes');
  });

  it('reports once per attribute name, because the markup is the cause', () => {
    warnings('<div data-hook="a">x</div>');

    expect(warnings('<p data-hook="b">y</p>')).toEqual([]);
  });

  it('says nothing for an attribute `compat` dropped too', () => {
    // `onclick` and `style` were refused in 1.x as well. Reporting them would
    // be telling an upgrader about something the upgrade did not change.
    expect(warnings('<div onclick="x()" style="color:red">x</div>')).toEqual([]);
  });

  it('says nothing under `compat`, where nothing is dropped', () => {
    setSanitizerPolicy('compat');

    expect(warnings('<div id="a" data-hook="b">x</div>')).toEqual([]);
  });

  it('says nothing for an attribute the caller allowed', () => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      seen.push(String(a[0]));
    });
    try {
      sanitizeHtml('<div data-hook="b">x</div>', { allowedDataAttributes: ['data-hook'] });
    } finally {
      spy.mockRestore();
    }

    expect(seen).toEqual([]);
  });
});
