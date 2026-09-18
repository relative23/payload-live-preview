import { describe, expect } from 'vitest';
import { fc, it } from '@fast-check/vitest';
import { morphElement } from '@core/morph';
import { propertyParameters } from './fast-check';

/**
 * ADR 0008 §2 as a property: for any keyed list and any rendered list of the
 * same kind of items, the morph leaves the live container equal to the
 * rendered markup, keeps the element of every key that survives, and
 * changes nothing when asked again with the same markup. Unkeyed lists get
 * the first and the last promise, not identity: positional pairing keeps
 * whatever lines up.
 */

const KEY = 'data-payload-key';
const options = { keyAttributes: [KEY] };

const key = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);
const text = fc.stringMatching(/^[A-Za-z0-9 ]{0,12}$/);
const item = fc.record({ key, text, flag: fc.boolean() });
const keyedList = fc.uniqueArray(item, { selector: (entry) => entry.key, maxLength: 12 });
const unkeyedList = fc.array(fc.record({ text, flag: fc.boolean() }), { maxLength: 12 });

interface Keyed {
  readonly key: string;
  readonly text: string;
  readonly flag: boolean;
}
interface Plain {
  readonly text: string;
  readonly flag: boolean;
}

function keyedHtml(items: readonly Keyed[]): string {
  return items
    .map(
      (entry) => `<li ${KEY}="${entry.key}"${entry.flag ? ' class="on"' : ''}>${entry.text}</li>`,
    )
    .join('');
}

function plainHtml(items: readonly Plain[]): string {
  return items.map((entry) => `<li${entry.flag ? ' class="on"' : ''}>${entry.text}</li>`).join('');
}

function list(inner: string): Element {
  const ul = document.createElement('ul');
  ul.innerHTML = inner;
  return ul;
}

describe('the keyed morph, for any list', () => {
  it.prop([keyedList, keyedList], propertyParameters(20260919))(
    'lands on the rendered markup and keeps the element of every surviving key',
    (before, after) => {
      const live = list(keyedHtml(before));
      const identities = new Map(
        Array.from(live.children, (child) => [child.getAttribute(KEY) ?? '', child]),
      );
      const rendered = list(keyedHtml(after));
      const wanted = rendered.innerHTML;
      expect(morphElement(live, rendered, options)).toBe(live);
      expect(live.innerHTML).toBe(wanted);
      for (const child of Array.from(live.children)) {
        const kept = identities.get(child.getAttribute(KEY) ?? '');
        if (kept !== undefined) expect(child).toBe(kept);
      }
      // Idempotent: the same markup again moves nothing.
      const snapshot = Array.from(live.children);
      morphElement(live, list(keyedHtml(after)), options);
      expect(Array.from(live.children)).toEqual(snapshot);
      expect(live.innerHTML).toBe(wanted);
    },
  );

  it.prop([unkeyedList, unkeyedList], propertyParameters(20260919))(
    'lands on the rendered markup for unkeyed items and is idempotent',
    (before, after) => {
      const live = list(plainHtml(before));
      const wanted = plainHtml(after);
      morphElement(live, list(wanted), options);
      expect(live.innerHTML).toBe(wanted);
      const snapshot = Array.from(live.childNodes);
      morphElement(live, list(wanted), options);
      expect(Array.from(live.childNodes)).toEqual(snapshot);
    },
  );

  it.prop([keyedList, keyedList], propertyParameters(20260919))(
    'keeps the focused input of a surviving key, with its caret',
    (before, after) => {
      const live = list(keyedHtml(before).replaceAll('</li>', '<input></li>'));
      document.body.replaceChildren(live);
      const first = live.querySelector('input');
      if (first === null) return;
      first.focus();
      first.value = 'typed';
      first.setSelectionRange(1, 3);
      const focusedKey = first.parentElement?.getAttribute(KEY) ?? '';
      morphElement(live, list(keyedHtml(after).replaceAll('</li>', '<input></li>')), options);
      if (after.some((entry) => entry.key === focusedKey)) {
        expect(document.activeElement).toBe(first);
        expect([first.selectionStart, first.selectionEnd]).toEqual([1, 3]);
        expect(first.value).toBe('typed');
      } else {
        expect(first.isConnected).toBe(false);
      }
    },
  );
});
