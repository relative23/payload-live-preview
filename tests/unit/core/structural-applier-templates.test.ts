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
});
