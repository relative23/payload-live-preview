import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { buildBuiltinRenderers } from '@field-types/index';
import { TRUSTED, fireMessage } from './lifecycle-harness';

/**
 * A binding's format and locale are read once, into the cached binding, and
 * the number renderer writes with them. A template that changes either on the
 * element it keeps (a morph, a framework re-render) has to reach the next
 * write: the observer has to rebuild the binding, and `skipUnchanged` must not
 * call a value unchanged that is now written differently. The value below is
 * 12.34 throughout; only the element's metadata moves.
 */

let runtime: LivePreviewRuntime | undefined;

afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

function start(skipUnchanged: boolean): void {
  runtime = new LivePreviewRuntime({
    renderers: buildBuiltinRenderers(),
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
    skipUnchanged,
  });
  runtime.start();
}

async function send(data: Record<string, unknown>, locale?: string): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data, ...(locale === undefined ? {} : { locale }) });
  await vi.advanceTimersByTimeAsync(20);
}

function price(attributes: string): HTMLElement {
  document.body.innerHTML = `
    <h1 data-payload-field="title">t</h1>
    <p data-payload-field="price" data-payload-type="number" ${attributes}>12</p>`;
  return document.querySelector<HTMLElement>('[data-payload-field="price"]')!;
}

/**
 * What the element shows after the first message, after `change`, and after
 * the next message. Past the observer's 100 ms debounce before that message,
 * so a rebuild the change asked for has run.
 */
async function across(element: HTMLElement, change: () => void): Promise<string[]> {
  const seen: string[] = [];
  await send({ title: 'A', price: 12.34 });
  seen.push(element.textContent);
  change();
  await vi.advanceTimersByTimeAsync(250);
  seen.push(element.textContent);
  await send({ title: 'B', price: 12.34 });
  seen.push(element.textContent);
  return seen;
}

describe('a changed data-payload-format reaches the binding', () => {
  it('writes number:2 as 12.34 when the page carries it from the start', async () => {
    const element = price('data-payload-locale="en-GB" data-payload-format="number:2"');
    start(true);
    await send({ title: 'A', price: 12.34 });
    expect(element.textContent).toBe('12.34');
  });

  it.each([true, false])(
    'skipUnchanged %s: the next message writes the new format',
    async (skipUnchanged) => {
      const element = price('data-payload-locale="en-GB" data-payload-format="number:0"');
      start(skipUnchanged);
      const seen = await across(element, () => {
        element.setAttribute('data-payload-format', 'number:2');
      });
      expect(seen).toEqual(['12', '12', '12.34']);
    },
  );

  it('skipUnchanged on: a binding rebuilt for another attribute is not skipped either', async () => {
    const element = price('data-payload-locale="en-GB" data-payload-format="number:0"');
    start(true);
    const seen = await across(element, () => {
      element.setAttribute('data-payload-format', 'number:2');
      // Rewriting a watched attribute to its own value queues a mutation record,
      // so the binding is rebuilt with the new format even without the fix.
      element.setAttribute('data-payload-type', 'number');
    });
    expect(seen).toEqual(['12', '12', '12.34']);
  });
});

describe('a changed locale reaches the binding', () => {
  it.each([true, false])(
    'skipUnchanged %s: data-payload-locale en-GB -> de-DE writes 12,34 on the next message',
    async (skipUnchanged) => {
      const element = price('data-payload-locale="en-GB" data-payload-format="number:2"');
      start(skipUnchanged);
      const seen = await across(element, () => {
        element.setAttribute('data-payload-locale', 'de-DE');
      });
      expect(seen).toEqual(['12.34', '12.34', '12,34']);
    },
  );

  it('skipUnchanged on: a new message locale reformats a binding that names none', async () => {
    const element = price('data-payload-format="number:2"');
    start(true);
    await send({ title: 'A', price: 12.34 }, 'en-GB');
    expect(element.textContent).toBe('12.34');
    await send({ title: 'A', price: 12.34 }, 'de-DE');
    expect(element.textContent).toBe('12,34');
  });
});
