/**
 * `data-payload-format`: a closed vocabulary deciding how a date or a number is
 * written. Without it a bound price shows the raw amount and a bound date an
 * ISO instant, so a template that formats on the server has to leave both
 * unbound — which is where an edit becomes invisible.
 *
 * Closed on purpose. Anything a consumer could pass here would be code running
 * inside the preview, and the runtime takes no code from the page. Two
 * renderers read it, so the parsing lives beside them rather than in either.
 *
 * `relative` ("in 3 days") is deliberately absent: choosing the unit and its
 * rounding is policy, not formatting, and two readers will want different
 * answers. A project that needs it renders it on the server behind a fragment.
 */

import { safeConsoleWarn } from '@core/diagnostics';

/** What a renderer does with a parsed vocabulary entry. */
export type ValueFormat =
  | { readonly kind: 'date'; readonly options: Intl.DateTimeFormatOptions }
  | { readonly kind: 'number'; readonly options: Intl.NumberFormatOptions };

const DATE_STYLES = new Set(['short', 'medium', 'long', 'full']);
const TIME_STYLES = new Set(['short', 'medium', 'long', 'full']);

/** ISO 4217: three letters, and `Intl` rejects anything else at construction. */
const CURRENCY_CODE = /^[A-Za-z]{3}$/u;
const FRACTION_DIGITS = /^[0-4]$/u;

/**
 * `undefined` for a spec this vocabulary does not contain — the caller then
 * keeps its own default formatting and reports LP0408 once for that element.
 */
export function parseValueFormat(spec: string): ValueFormat | undefined {
  const separator = spec.indexOf(':');
  const name = separator === -1 ? spec : spec.slice(0, separator);
  const argument = separator === -1 ? undefined : spec.slice(separator + 1);

  switch (name) {
    case 'date':
      if (argument === undefined) return dateFormat({ dateStyle: 'medium' });
      return DATE_STYLES.has(argument)
        ? dateFormat({ dateStyle: argument as Intl.DateTimeFormatOptions['dateStyle'] })
        : undefined;
    case 'time':
      if (argument === undefined) return dateFormat({ timeStyle: 'short' });
      return TIME_STYLES.has(argument)
        ? dateFormat({ timeStyle: argument as Intl.DateTimeFormatOptions['timeStyle'] })
        : undefined;
    case 'datetime':
      // The bare form is the renderer's own default, so `datetime` changes
      // nothing and exists to be written down next to the others.
      if (argument === undefined) return dateFormat({ dateStyle: 'medium', timeStyle: 'short' });
      return DATE_STYLES.has(argument)
        ? dateFormat({
            dateStyle: argument as Intl.DateTimeFormatOptions['dateStyle'],
            timeStyle: argument === 'short' ? 'short' : 'medium',
          })
        : undefined;
    case 'number':
      if (argument === undefined) return numberFormat({});
      if (!FRACTION_DIGITS.test(argument)) return undefined;
      return numberFormat({
        minimumFractionDigits: Number(argument),
        maximumFractionDigits: Number(argument),
      });
    case 'currency':
      if (argument === undefined || !CURRENCY_CODE.test(argument)) return undefined;
      return numberFormat({ style: 'currency', currency: argument.toUpperCase() });
    case 'percent':
      return argument === undefined ? numberFormat({ style: 'percent' }) : undefined;
    default:
      return undefined;
  }
}

function dateFormat(options: Intl.DateTimeFormatOptions): ValueFormat {
  return { kind: 'date', options };
}

function numberFormat(options: Intl.NumberFormatOptions): ValueFormat {
  return { kind: 'number', options };
}

const warned = new WeakSet<Element>();

/** Reported once per element: the markup is the cause, and it does not change. */
export function warnUnknownFormat(element: Element, fieldName: string, spec: string): void {
  if (warned.has(element)) return;
  warned.add(element);
  safeConsoleWarn(
    `[live-preview] LP0408: data-payload-format="${spec}" on "${fieldName}" is not a ` +
      'known format; the default formatting was used. Known: date, date:short|medium|long|full, ' +
      'time, datetime, number, number:0-4, currency:XXX, percent.',
  );
}

/**
 * The options a renderer should use, or `undefined` to keep its own default —
 * which is also the answer when the spec belongs to the other renderer, so
 * `currency:EUR` on a date changes nothing rather than breaking it.
 */
export function formatOptionsFor<K extends ValueFormat['kind']>(
  kind: K,
  spec: string | undefined,
  element: Element,
  fieldName: string,
): Extract<ValueFormat, { kind: K }>['options'] | undefined {
  if (spec === undefined || spec === '') return undefined;
  const parsed = parseValueFormat(spec);
  if (parsed === undefined) {
    warnUnknownFormat(element, fieldName, spec);
    return undefined;
  }
  if (parsed.kind !== kind) return undefined;
  return parsed.options;
}
