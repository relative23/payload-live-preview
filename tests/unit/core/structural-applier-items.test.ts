import { describe, expect, it } from 'vitest';
import { applyStructuralPatches, KEY_ATTRIBUTE } from '@core/structural-applier';
import { diffArray } from '@schema/diff';
import { makeList, store } from './structural-applier-harness';

describe('applyStructuralPatches — item diffs', () => {
  it('inserts a new item at the right index', () => {
    const items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ];
    const ul = makeList('<li>{{label}}</li>', items);
    const next = [items[0]!, { id: 3, label: 'c' }, items[1]!];
    const patches = diffArray(items, next);
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches,
      nextItems: next,
    });
    expect([...ul.children].map((el) => el.textContent)).toEqual(['a', 'c', 'b']);
  });
  it('removes the right item', () => {
    const items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ];
    const ul = makeList('<li>{{label}}</li>', items);
    const next = [items[0]!, items[2]!];
    const patches = diffArray(items, next);
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches,
      nextItems: next,
    });
    expect([...ul.children].map((el) => el.textContent)).toEqual(['a', 'c']);
  });
  it('moves an item using its id-based key', () => {
    const items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ];
    const ul = makeList('<li>{{label}}</li>', items);
    const original = ul.querySelector(`[${KEY_ATTRIBUTE}="2"]`);
    const next = [items[1]!, items[0]!, items[2]!];
    const patches = diffArray(items, next);
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches,
      nextItems: next,
    });
    expect([...ul.children].map((el) => el.textContent)).toEqual(['b', 'a', 'c']);
    // The same element survived the move — reference equality verifies
    // that the DOM was not rebuilt.
    expect(ul.children[0]).toBe(original);
  });
  it('removes unclaimed SSR children after placing keyed items in final order', () => {
    const items = [
      { id: 'a', label: 'a' },
      { id: 'b', label: 'b' },
    ];
    const ul = makeList('<li>{{label}}</li>', items);
    const unclaimedBefore = document.createElement('li');
    const unclaimedMiddle = document.createElement('li');
    unclaimedBefore.textContent = 'stale-before';
    unclaimedMiddle.textContent = 'stale-middle';
    ul.prepend(unclaimedBefore);
    ul.insertBefore(unclaimedMiddle, ul.lastElementChild);
    const originalB = ul.querySelector(`[${KEY_ATTRIBUTE}="b"]`);
    const next = [items[1]!, items[0]!];

    const mutated = applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches: diffArray(items, next),
      nextItems: next,
    });

    expect(mutated).toBe(true);
    expect([...ul.children].map((element) => element.textContent)).toEqual(['b', 'a']);
    expect(ul.firstElementChild).toBe(originalB);
    expect(unclaimedBefore.isConnected).toBe(false);
    expect(unclaimedMiddle.isConnected).toBe(false);
  });
  it('updates an item in place', () => {
    const items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ];
    const ul = makeList('<li>{{label}}</li>', items);
    const next = [
      { id: 1, label: 'a' },
      { id: 2, label: 'NEW' },
    ];
    const patches = diffArray(items, next);
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches,
      nextItems: next,
    });
    expect([...ul.children].map((el) => el.textContent)).toEqual(['a', 'NEW']);
  });
  it('replaces an item with a different block type', () => {
    const items = [{ id: 1, blockType: 'callout', label: 'hi' }];
    const ul = makeList('<li>{{label}}</li>', items);
    const next = [{ id: 1, blockType: 'image', label: 'pic' }];
    const patches = diffArray(items, next);
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches,
      nextItems: next,
    });
    expect([...ul.children].map((el) => el.textContent)).toEqual(['pic']);
  });
  it('renders the {{index}} placeholder when present', () => {
    const next = [{ id: 1, label: 'x' }];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: '<li>{{index}}-{{label}}</li>',
      container: ul,
      patches: diffArray([], next),
      nextItems: next,
    });
    expect(ul.firstElementChild?.textContent).toBe('0-x');
  });
  it('escapes HTML characters in template values', () => {
    const next = [{ id: 1, label: '<script>x</script>' }];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches: diffArray([], next),
      nextItems: next,
    });
    expect(ul.innerHTML).not.toContain('<script>');
    expect(ul.firstElementChild?.textContent).toContain('<script>x</script>');
  });
  it('keys new items with their id for future diffs', () => {
    const next = [{ id: 'abc', label: 'x' }];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches: diffArray([], next),
      nextItems: next,
    });
    expect(ul.firstElementChild?.getAttribute(KEY_ATTRIBUTE)).toBe('abc');
  });
  it('no-op when patches list is empty', () => {
    const items = [{ id: 1, label: 'a' }];
    const ul = makeList('<li>{{label}}</li>', items);
    const original = ul.firstElementChild;
    applyStructuralPatches({
      store,
      template: '<li>{{label}}</li>',
      container: ul,
      patches: [],
      nextItems: items,
    });
    expect(ul.firstElementChild).toBe(original);
  });
});
