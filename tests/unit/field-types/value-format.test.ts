import { describe, expect, it, vi } from 'vitest';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

/**
 * `data-payload-format` — the closed vocabulary that decides how a date or a
 * number is written. Without it a bound price shows the raw amount and a bound
 * date an ISO instant, so a template that formats server-side has to leave both
 * unbound. The expectations below pin `en-GB`, and the fixed instant is chosen
 * away from midnight so no time zone can move its calendar day.
 */
const INSTANT = '2026-10-17T14:05:00.000Z';
const context = emptyContext();

function render(format: string, value: unknown, renderer: 'date' | 'number' = 'date'): string {
  const element = document.createElement('span');
  rendererNamed(renderer).render(makeTarget(element, { format }), value, {
    ...context,
    locale: 'en-GB',
  });
  return element.textContent;
}

describe('data-payload-format — dates', () => {
  it.each([
    ['date', /^17 Oct 2026$/u],
    ['date:short', /^17\/10\/2026$/u],
    ['date:medium', /^17 Oct 2026$/u],
    ['date:long', /^17 October 2026$/u],
    ['date:full', /^Saturday,? 17 October 2026$/u],
    ['time', /^\d{2}:\d{2}$/u],
    ['datetime', /^17 Oct 2026, \d{2}:\d{2}$/u],
  ])('%s', (format, expected) => {
    expect(render(format, INSTANT)).toMatch(expected);
  });

  it('leaves the ISO instant in the datetime attribute, whatever the label says', () => {
    const element = document.createElement('time');
    rendererNamed('date').render(makeTarget(element, { format: 'date:long' }), INSTANT, context);
    expect(element.getAttribute('datetime')).toBe(INSTANT);
  });
});

describe('data-payload-format — numbers', () => {
  it.each([
    ['number', 1234.5, /^1,234\.5$/u],
    ['number:0', 1234.5, /^1,235$/u],
    ['number:2', 1234.5, /^1,234\.50$/u],
    ['currency:EUR', 12, /^€12\.00$/u],
    // en-GB writes the foreign currency with its region prefix; the local one without.
    ['currency:USD', 1234.5, /^US\$1,234\.50$/u],
    ['percent', 0.25, /^25%$/u],
  ])('%s', (format, value, expected) => {
    expect(render(format, value, 'number')).toMatch(expected);
  });

  it('formats the amount it is given; minor units are the document’s business', () => {
    // A field holding cents renders as cents. Dividing would be data shaping,
    // and the runtime has no way to know which fields are minor units.
    expect(render('currency:EUR', 1200, 'number')).toMatch(/1,200\.00/u);
  });
});

describe('data-payload-format — a vocabulary it does not know', () => {
  it('writes the unformatted value and says so once per element', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const element = document.createElement('span');
    const target = makeTarget(element, { format: 'date:like-a-poem' });

    rendererNamed('date').render(target, INSTANT, context);
    rendererNamed('date').render(target, INSTANT, context);

    expect(element.textContent).not.toBe('');
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('LP0408'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('ignores a number vocabulary on a date and the other way round', () => {
    expect(render('currency:EUR', INSTANT)).not.toContain('€');
    expect(render('date:long', 1234.5, 'number')).toMatch(/1,234\.5/u);
  });
});
