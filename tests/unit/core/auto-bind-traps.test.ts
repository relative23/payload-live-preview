/**
 * F1 of ADR 0014: on a page where a field's value stands somewhere it must not
 * be bound to, `autoBind: 'unique'` binds nothing — and the page, held against
 * the markup the server sent, has not moved after an edit.
 *
 * The corpus is `tests/fixtures/auto-bind-traps`. Every trap is replayed the
 * way a session goes: the saved document as the connection's first message
 * (the one the search runs on), then an edit to every field. A guessed binding
 * would write that edit into the trap, and the fidelity comparison — the same
 * one the E2E oracle uses — would report the element and both values.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { compareFidelity, reportDifferences } from '../../e2e/helpers/fidelity';
import { AUTO_BIND_TRAPS, editedFields, type AutoBindTrap } from '../../fixtures/auto-bind-traps';
import { post, startRuntime, type RuntimeHarness } from '../../helpers/runtime';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function mount(trap: AutoBindTrap): void {
  document.head.innerHTML = trap.head ?? '';
  document.body.innerHTML = trap.html;
  trap.mount?.(document.body);
}

async function replay(trap: AutoBindTrap): Promise<RuntimeHarness> {
  mount(trap);
  const harness = startRuntime({ renderers: buildBuiltinRenderers(), autoBind: 'unique' });
  post(trap.fields);
  await vi.advanceTimersByTimeAsync(50);
  post(editedFields(trap.fields));
  await vi.advanceTimersByTimeAsync(50);
  return harness;
}

describe('a value the runtime must not bind to', () => {
  it('binds nothing on any page of the corpus, and leaves every page as the server sent it', async () => {
    // One test over the whole corpus rather than one per trap, because the
    // inventory counts declarations statically; the failure names each trap
    // that bound, so nothing is lost by it.
    const bound: string[] = [];
    for (const trap of AUTO_BIND_TRAPS) {
      const harness = await replay(trap);
      try {
        const { guessed } = harness.runtime.inspect().bindings;
        const stamped = document.querySelectorAll('[data-payload-guessed]').length;
        // The oracle's comparison: a wrong write is a divergence from what the server rendered.
        const differences = compareFidelity(document.body.innerHTML, trap.html);
        if (guessed.length > 0 || stamped > 0 || differences.length > 0) {
          bound.push(
            `${trap.name} (${trap.why}): guessed ${JSON.stringify(guessed)}, ` +
              `${String(stamped)} stamped, ${reportDifferences(differences)}`,
          );
        }
      } finally {
        harness.runtime.destroy();
        document.head.innerHTML = '';
        document.body.innerHTML = '';
      }
    }
    expect(bound).toEqual([]);
  });

  it('is measured on a corpus that covers every exclusion the record names', () => {
    // ADR 0014 §2 lists where the runtime never guesses. A trap per item keeps
    // the corpus and the record in step: dropping one here is a red test.
    const names = AUTO_BIND_TRAPS.map((trap) => trap.name).join('\n');
    for (const region of [
      'a script',
      'a style element',
      'a template',
      'a textarea',
      'an input value',
      'a contenteditable subtree',
      'an opted-out subtree',
      'a shadow root',
      'the head',
      'declared binding',
      'copyright',
      'footer address',
    ]) {
      expect(names).toContain(region);
    }
    expect(AUTO_BIND_TRAPS.length).toBeGreaterThanOrEqual(30);
  });
});
