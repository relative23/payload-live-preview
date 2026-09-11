import { describe, expect, it } from 'vitest';
import { applyStructuralPatches, KEY_ATTRIBUTE } from '@core/structural-applier';
import { diffArray } from '@schema/diff';
import { makeList, store } from './structural-applier-harness';

describe('applyStructuralPatches — template filling edge cases', () => {
  it('renders literal $-sequences without triggering replace patterns', () => {
    const items: unknown[] = [];
    const ul = makeList('<li>{{label}}</li>', items);
    const next = [{ id: 1, label: "Price: $& $' $` $$" }];
    const patches = diffArray(items, next);
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches,
      nextItems: next,
    });
    expect(ul.children[0]?.textContent).toBe("Price: $& $' $` $$");
  });
  it('does not interpret placeholders introduced by an earlier field replacement', () => {
    const ul = document.createElement('ul');
    const next = [
      {
        id: 1,
        label: 'literal {{index}} and {{suffix}}',
        suffix: 'must not replace nested text',
      },
    ];

    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches: diffArray([], next),
      nextItems: next,
    });

    expect(ul.firstElementChild?.textContent).toBe('literal {{index}} and {{suffix}}');
  });
  it('keeps key order correct when one update also moves in the same patch set', () => {
    const previous = [
      { id: 'a', label: 'A before' },
      { id: 'b', label: 'B' },
    ];
    const next = [
      { id: 'b', label: 'B' },
      { id: 'a', label: 'A after' },
    ];
    const ul = makeList('<li>{{label}}</li>', previous);

    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches: diffArray(previous, next),
      nextItems: next,
    });

    expect([...ul.children].map((element) => element.getAttribute(KEY_ATTRIBUTE))).toEqual([
      'b',
      'a',
    ]);
    expect([...ul.children].map((element) => element.textContent)).toEqual(['B', 'A after']);
  });

  /**
   * The same loss the fidelity oracle measured on the plain array renderer: an
   * item rebuilt from a template carries what the author wrote and nothing the
   * framework's compiler added around it. Here it also has to survive the
   * morph, which strips from the live item every attribute the rendered one
   * does not have.
   */
  it('keeps the scoped-style marker the server put on the items it replaces', () => {
    const previous = [{ id: 'a', label: 'A' }];
    const next = [
      { id: 'a', label: 'A edited' },
      { id: 'b', label: 'B' },
    ];
    const ul = makeList('<li>{{label}}</li>', previous);
    for (const item of ul.children) item.setAttribute('data-astro-cid-j7pv25f6', '');

    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches: diffArray(previous, next),
      nextItems: next,
    });

    // The morphed item and the inserted one: an insert has no predecessor of
    // its own, and would be the odd row out without the shared answer.
    expect(
      [...ul.children].map((element) => element.getAttribute('data-astro-cid-j7pv25f6')),
    ).toEqual(['', '']);
    expect([...ul.children].map((element) => element.getAttribute(KEY_ATTRIBUTE))).toEqual([
      'a',
      'b',
    ]);
  });
});
