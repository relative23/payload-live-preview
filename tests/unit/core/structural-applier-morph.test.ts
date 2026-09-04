import { describe, expect, it } from 'vitest';
import { applyStructuralPatches, createStructuralStore } from '@core/structural-applier';
import { diffArray } from '@schema/diff';

describe('morph switch and template tags (ADR 0008)', () => {
  const TEMPLATE =
    '<li><span class="t">{{title}}</span><div data-payload-nested-key="tags" data-payload-nested-template="<em>{{value}}</em>"></div></li>';

  function seed(morph: boolean) {
    document.body.innerHTML = '<ul></ul>';
    const container = document.body.firstElementChild!;
    const local = createStructuralStore();
    const initial = [{ id: 'a', title: 'A', tags: ['x'] }];
    applyStructuralPatches({
      template: TEMPLATE,
      container,
      patches: diffArray([], initial),
      nextItems: initial,
      store: local,
      forceRender: true,
      morph,
    });
    const next = [{ id: 'a', title: 'A!', tags: ['x', 'y'] }];
    const before = container.firstElementChild;
    const slotBefore = container.querySelector('[data-payload-nested-key="tags"]');
    applyStructuralPatches({
      template: TEMPLATE,
      container,
      patches: diffArray(initial, next),
      nextItems: next,
      store: local,
      morph,
    });
    return { container, before, slotBefore };
  }
  it('with morph: false keeps the pre-1.3.0 path — the item is replaced, the live slot transplanted', () => {
    const { container, before, slotBefore } = seed(false);
    expect(container.firstElementChild).not.toBe(before);
    expect(container.querySelector('[data-payload-nested-key="tags"]')).toBe(slotBefore);
    expect(container.querySelector('.t')?.textContent).toBe('A!');
    expect(Array.from(container.querySelectorAll('em'), (em) => em.textContent)).toEqual([
      'x',
      'y',
    ]);
  });
  it('with the morph the item and its slot both keep their identity', () => {
    const { container, before, slotBefore } = seed(true);
    expect(container.firstElementChild).toBe(before);
    expect(container.querySelector('[data-payload-nested-key="tags"]')).toBe(slotBefore);
    expect(container.querySelector('.t')?.textContent).toBe('A!');
    expect(Array.from(container.querySelectorAll('em'), (em) => em.textContent)).toEqual([
      'x',
      'y',
    ]);
  });
  it('keeps custom elements and form controls written in the template, but never from a value', () => {
    document.body.innerHTML = '<ul></ul>';
    const container = document.body.firstElementChild!;
    const items = [{ id: 1, title: '<x-evil></x-evil><input onfocus="x()">' }];
    applyStructuralPatches({
      template: '<li><x-counter></x-counter><input class="i"><b>{{title}}</b></li>',
      container,
      patches: diffArray([], items),
      nextItems: items,
      store: createStructuralStore(),
      forceRender: true,
    });
    const li = container.firstElementChild!;
    expect(li.querySelector('x-counter')).not.toBeNull();
    expect(li.querySelector('input.i')).not.toBeNull();
    expect(li.querySelector('x-evil')).toBeNull();
    expect(li.querySelectorAll('input')).toHaveLength(1);
    expect(li.querySelector('b')?.textContent).toBe('<x-evil></x-evil><input onfocus="x()">');
  });
});
