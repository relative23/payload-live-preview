import { describe, expect, it } from 'vitest';
import { formatForInput } from '@field-types/date';
import type { PayloadFieldSchema } from '@/types/payload-protocol';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

function selectWith(values: readonly string[], multiple = false): HTMLSelectElement {
  const el = document.createElement('select');
  el.multiple = multiple;
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    el.appendChild(option);
  }
  return el;
}

const SELECT_SCHEMA: PayloadFieldSchema = {
  name: 'f',
  type: 'select',
  options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }, 'c'],
};

describe('select renderer', () => {
  it('updates select value', () => {
    const el = selectWith(['a', 'b']);
    rendererNamed('select').render(makeTarget(el), 'b', emptyContext());
    expect(el.value).toBe('b');
  });

  it('selects every value of a has-many field on <select multiple>', () => {
    const el = selectWith(['a', 'b', 'c'], true);
    rendererNamed('select').render(makeTarget(el), ['a', 'c'], emptyContext());
    expect(Array.from(el.selectedOptions, (o) => o.value)).toEqual(['a', 'c']);

    rendererNamed('select').render(makeTarget(el), ['b'], emptyContext());
    expect(Array.from(el.selectedOptions, (o) => o.value)).toEqual(['b']);
  });

  it('uses the first value of an array on a single select', () => {
    const el = selectWith(['a', 'b']);
    rendererNamed('select').render(makeTarget(el), ['b', 'a'], emptyContext());
    expect(el.value).toBe('b');
  });

  it('updates radio checked state', () => {
    const el = document.createElement('input');
    el.type = 'radio';
    el.value = 'yes';
    rendererNamed('radio').render(makeTarget(el), 'yes', emptyContext());
    expect(el.checked).toBe(true);
    rendererNamed('radio').render(makeTarget(el), 'no', emptyContext());
    expect(el.checked).toBe(false);
  });

  it('joins has-many values as text', () => {
    const el = document.createElement('span');
    rendererNamed('select').render(makeTarget(el), ['a', 'b'], emptyContext());
    expect(el.textContent).toBe('a, b');
  });

  it('shows option labels from the schema in text mode', () => {
    const el = document.createElement('span');
    const context = { ...emptyContext(), schema: SELECT_SCHEMA };
    rendererNamed('select').render(makeTarget(el), ['a', 'b', 'c', 'zzz'], context);
    expect(el.textContent).toBe('Alpha, Beta, c, zzz');
  });

  it('writes option values, not labels, into form controls', () => {
    const el = selectWith(['a', 'b']);
    rendererNamed('select').render(makeTarget(el), 'a', {
      ...emptyContext(),
      schema: SELECT_SCHEMA,
    });
    expect(el.value).toBe('a');
  });
});

describe('checkbox renderer', () => {
  it('updates checked on checkbox input', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    rendererNamed('checkbox').render(makeTarget(el), true, emptyContext());
    expect(el.checked).toBe(true);
  });

  it('updates aria-checked on elements that have it', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-checked', 'false');
    rendererNamed('checkbox').render(makeTarget(el), true, emptyContext());
    expect(el.getAttribute('aria-checked')).toBe('true');
  });

  it('falls back to textContent for arbitrary elements', () => {
    const el = document.createElement('span');
    rendererNamed('checkbox').render(makeTarget(el), true, emptyContext());
    expect(el.textContent).toBe('true');
  });

  it.each([
    ['false', false],
    ['0', false],
    ['', false],
    ['no', false],
    ['true', true],
    ['1', true],
    [0, false],
    [1, true],
    [null, false],
    [undefined, false],
    [false, false],
  ])('reads %j as %s', (value, expected) => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = !expected;
    rendererNamed('checkbox').render(makeTarget(el), value, emptyContext());
    expect(el.checked).toBe(expected);
  });
});

function localDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe('date renderer', () => {
  it('formats date for <time> element with datetime attribute', () => {
    const el = document.createElement('time');
    rendererNamed('date').render(makeTarget(el), '2025-06-15T12:34:56.000Z', emptyContext());
    expect(el.getAttribute('datetime')).toBe('2025-06-15T12:34:56.000Z');
    expect(el.textContent).not.toBe('');
  });

  it('formats date for plain element', () => {
    const el = document.createElement('span');
    rendererNamed('date').render(makeTarget(el), '2025-06-15', emptyContext());
    expect(el.textContent).not.toBe('');
  });

  it.each([
    ['just after local midnight', new Date(2025, 5, 15, 0, 30)],
    ['just before local midnight', new Date(2025, 5, 15, 23, 30)],
  ])('writes the local calendar day into a date input (%s)', (_label, instant) => {
    const el = document.createElement('input');
    el.type = 'date';
    rendererNamed('date').render(makeTarget(el), instant.toISOString(), emptyContext());
    expect(el.value).toBe(localDay(instant));
    expect(el.value).toBe('2025-06-15');
  });

  it('writes local wall-clock time into a datetime-local input', () => {
    const el = document.createElement('input');
    el.type = 'datetime-local';
    const instant = new Date(2025, 5, 15, 0, 30);
    rendererNamed('date').render(makeTarget(el), instant.toISOString(), emptyContext());
    expect(el.value).toBe('2025-06-15T00:30');
  });

  it('formats time inputs and leaves other inputs on the ISO instant', () => {
    const instant = new Date(2025, 5, 15, 9, 5);
    expect(formatForInput('time', instant)).toBe('09:05');
    expect(formatForInput('text', instant)).toBe(instant.toISOString());
  });

  it('accepts a numeric epoch', () => {
    const el = document.createElement('time');
    const instant = new Date(2025, 5, 15, 12, 0);
    rendererNamed('date').render(makeTarget(el), instant.getTime(), emptyContext());
    expect(el.getAttribute('datetime')).toBe(instant.toISOString());
    expect(el.textContent).not.toContain('Invalid');
  });

  it('clears element when value is empty', () => {
    const el = document.createElement('time');
    el.setAttribute('datetime', 'x');
    el.textContent = 'x';
    rendererNamed('date').render(makeTarget(el), null, emptyContext());
    expect(el.getAttribute('datetime')).toBeNull();
    expect(el.textContent).toBe('');
  });

  it('falls back to raw string when input is not parseable', () => {
    const el = document.createElement('span');
    rendererNamed('date').render(makeTarget(el), 'not-a-date', emptyContext());
    expect(el.textContent).toBe('not-a-date');
  });
});

describe('number renderer', () => {
  it('formats numbers via Intl.NumberFormat', () => {
    const el = document.createElement('span');
    rendererNamed('number').render(makeTarget(el), 1234.5, emptyContext({}));
    expect(el.textContent).toMatch(/1[.,]234/);
  });

  it('writes raw number to input', () => {
    const el = document.createElement('input');
    el.type = 'number';
    rendererNamed('number').render(makeTarget(el), 42, emptyContext());
    expect(el.value).toBe('42');
  });

  it('falls back to string for NaN', () => {
    const el = document.createElement('span');
    rendererNamed('number').render(makeTarget(el), 'oops', emptyContext());
    expect(el.textContent).toBe('oops');
  });

  it('clears empty values', () => {
    const el = document.createElement('span');
    el.textContent = '1';
    rendererNamed('number').render(makeTarget(el), null, emptyContext());
    expect(el.textContent).toBe('');
  });
});
