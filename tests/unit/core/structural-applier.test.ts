import { describe, expect, it, vi } from 'vitest';
import {
  applyStructuralPatches,
  createStructuralStore,
  KEY_ATTRIBUTE,
} from '@core/structural-applier';

// One store shared across the file is safe: it's a WeakMap keyed by the
// container element, and every test builds fresh elements, so tests can't
// collide. Within a test, sequential calls on the same container share
// memory, which is exactly what the nested-reconciliation cases exercise.
const store = createStructuralStore();
import { diffArray } from '@schema/diff';

function asLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function makeList(_template: string, items: readonly unknown[]): HTMLUListElement {
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      const id = record['id'];
      if (typeof id === 'string' || typeof id === 'number') {
        li.setAttribute(KEY_ATTRIBUTE, asLabel(id));
      }
      li.textContent = asLabel(record['label']);
    } else {
      li.textContent = asLabel(item);
    }
    ul.appendChild(li);
  }
  return ul;
}

describe('applyStructuralPatches', () => {
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

describe('applyStructuralPatches — recursive nested slots', () => {
  const ITEM_TEMPLATE =
    '<li>{{title}}<ul data-payload-nested-key="ctas" data-payload-nested-template="&lt;a&gt;{{label}}&lt;/a&gt;"></ul></li>';

  function ctaLabels(item: Element): string[] {
    const slot = item.querySelector('[data-payload-nested-key="ctas"]');
    if (!slot) return [];
    return Array.from(slot.children).map((c) => c.textContent);
  }

  it('populates nested children on the initial insert', () => {
    const next = [
      {
        id: 1,
        title: 'Card A',
        ctas: [
          { id: 'cta-1', label: 'Buy' },
          { id: 'cta-2', label: 'Demo' },
        ],
      },
    ];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray([], next),
      nextItems: next,
    });
    const card = ul.firstElementChild!;
    expect(ctaLabels(card)).toEqual(['Buy', 'Demo']);
    const slot = card.querySelector('[data-payload-nested-key="ctas"]')!;
    expect(slot.children[0]!.getAttribute(KEY_ATTRIBUTE)).toBe('cta-1');
  });

  it('preserves nested DOM identity when only the parent title changes', () => {
    const prev = [
      {
        id: 1,
        title: 'Card A',
        ctas: [{ id: 'cta-1', label: 'Buy' }],
      },
    ];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray([], prev),
      nextItems: prev,
    });
    const ctaEl = ul.querySelector(`[${KEY_ATTRIBUTE}="cta-1"]`)!;

    const next = [
      {
        id: 1,
        title: 'Card A — updated',
        ctas: prev[0]!.ctas,
      },
    ];
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray(prev, next),
      nextItems: next,
    });
    expect(ul.firstElementChild!.textContent).toContain('Card A — updated');
    // Same DOM node survives — proof we didn't rebuild the inner sub-tree.
    expect(ul.querySelector(`[${KEY_ATTRIBUTE}="cta-1"]`)).toBe(ctaEl);
  });

  it('updates nested template metadata recursively while retaining the slot identity', () => {
    const previousTemplate =
      '<li>{{title}}<ul class="before" data-payload-nested-key="ctas" ' +
      'data-payload-nested-template="&lt;a class=&quot;before&quot;&gt;{{label}}&lt;/a&gt;"></ul></li>';
    const nextTemplate =
      '<li>{{title}}<ul class="after" data-payload-nested-key="ctas" ' +
      'data-payload-nested-template="&lt;a class=&quot;after&quot;&gt;{{label}}&lt;/a&gt;"></ul></li>';
    const items = [{ id: 1, title: 'Card', ctas: [{ id: 'cta-1', label: 'Buy' }] }];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: previousTemplate,
      container: ul,
      patches: diffArray([], items),
      nextItems: items,
    });
    const slot = ul.querySelector('[data-payload-nested-key="ctas"]');
    const previousCta = ul.querySelector(`[${KEY_ATTRIBUTE}="cta-1"]`);
    if (slot === null || previousCta === null) throw new Error('initial nested structure missing');

    applyStructuralPatches({
      store,
      template: nextTemplate,
      container: ul,
      patches: [],
      nextItems: items,
      forceRender: true,
    });

    const nextSlot = ul.querySelector('[data-payload-nested-key="ctas"]');
    const nextCta = ul.querySelector(`[${KEY_ATTRIBUTE}="cta-1"]`);
    expect(nextSlot).toBe(slot);
    expect(nextSlot?.className).toBe('after');
    expect(nextSlot?.getAttribute('data-payload-nested-template')).toContain('class="after"');
    expect(nextCta?.className).toBe('after');
    // ADR 0008: a template change re-renders the item, and the morph edits the
    // live element toward that markup — the node keeps its identity, its class
    // above proves the update landed.
    expect(nextCta).toBe(previousCta);
  });

  it('uses sanitized static slot content when a nested template is removed', () => {
    const previousTemplate =
      '<section><ul data-payload-nested-key="ctas" ' +
      'data-payload-nested-template="&lt;li&gt;{{label}}&lt;/li&gt;"></ul></section>';
    const nextTemplate =
      '<section><ul data-payload-nested-key="ctas"><li class="static">Static fallback' +
      '<script>unsafe()</script></li></ul></section>';
    const items = [{ id: 'card', ctas: [{ id: 'cta', label: 'Managed child' }] }];
    const container = document.createElement('main');

    applyStructuralPatches({
      store,
      template: previousTemplate,
      container,
      patches: diffArray([], items),
      nextItems: items,
    });
    const previousSlot = container.querySelector('[data-payload-nested-key="ctas"]');
    const previousManagedChild = previousSlot?.firstElementChild;
    expect(previousSlot?.textContent).toBe('Managed child');

    applyStructuralPatches({
      store,
      template: nextTemplate,
      container,
      patches: [],
      nextItems: items,
      forceRender: true,
    });

    const nextSlot = container.querySelector('[data-payload-nested-key="ctas"]');
    expect(nextSlot?.hasAttribute('data-payload-nested-template')).toBe(false);
    expect(nextSlot?.innerHTML).toBe('<li class="static">Static fallback</li>');
    expect(nextSlot?.firstElementChild).not.toBe(previousManagedChild);
    expect(previousManagedChild?.isConnected).toBe(false);
    expect(container.querySelector(`[${KEY_ATTRIBUTE}="cta"]`)).toBeNull();
  });

  it('preflights the complete nested tree before mutating live DOM or memory', () => {
    const escapeAttribute = (value: string): string =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    const previousLeafTemplate = '<span class="safe">{{label}}</span>';
    const invalidLeafTemplate = '<script>{{label}}</script>';
    const buildGroupTemplate = (leafTemplate: string): string =>
      '<li>{{title}}<div data-payload-nested-key="links" ' +
      `data-payload-nested-template="${escapeAttribute(leafTemplate)}"></div></li>`;
    const buildCardTemplate = (groupTemplate: string): string =>
      '<section>{{title}}<ul data-payload-nested-key="groups" ' +
      `data-payload-nested-template="${escapeAttribute(groupTemplate)}"></ul></section>`;
    const previousTemplate = buildCardTemplate(buildGroupTemplate(previousLeafTemplate));
    const invalidTemplate = buildCardTemplate(buildGroupTemplate(invalidLeafTemplate));
    const items = [
      {
        id: 'card',
        title: 'Card',
        groups: [
          {
            id: 'group',
            title: 'Group',
            links: [{ id: 'link', label: 'Safe link' }],
          },
        ],
      },
    ];
    const container = document.createElement('main');
    expect(
      applyStructuralPatches({
        store,
        template: previousTemplate,
        container,
        patches: diffArray([], items),
        nextItems: items,
      }),
    ).toBe(true);
    const card = container.firstElementChild;
    const group = container.querySelector(`[${KEY_ATTRIBUTE}="group"]`);
    const link = container.querySelector(`[${KEY_ATTRIBUTE}="link"]`);
    const leafSlot = container.querySelector('[data-payload-nested-key="links"]');
    if (card === null || group === null || link === null || leafSlot === null) {
      throw new Error('initial recursive structure missing');
    }
    const previousMarkup = container.innerHTML;
    const previousLeafMetadata = leafSlot.getAttribute('data-payload-nested-template');

    const outcome = applyStructuralPatches({
      store,
      template: invalidTemplate,
      container,
      patches: [],
      nextItems: items,
      forceRender: true,
    });

    expect(outcome).toBeNull();
    expect(container.innerHTML).toBe(previousMarkup);
    expect(container.firstElementChild).toBe(card);
    expect(container.querySelector(`[${KEY_ATTRIBUTE}="group"]`)).toBe(group);
    expect(container.querySelector(`[${KEY_ATTRIBUTE}="link"]`)).toBe(link);
    expect(leafSlot.getAttribute('data-payload-nested-template')).toBe(previousLeafMetadata);
  });

  it('diffs nested arrays surgically when only nested items change', () => {
    const prev = [
      {
        id: 1,
        title: 'Card A',
        ctas: [
          { id: 'cta-1', label: 'Buy' },
          { id: 'cta-2', label: 'Demo' },
        ],
      },
    ];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray([], prev),
      nextItems: prev,
    });
    const survivor = ul.querySelector(`[${KEY_ATTRIBUTE}="cta-2"]`)!;

    const next = [
      {
        id: 1,
        title: 'Card A',
        ctas: [
          { id: 'cta-2', label: 'Demo' },
          { id: 'cta-3', label: 'Try' },
        ],
      },
    ];
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray(prev, next),
      nextItems: next,
    });
    const card = ul.firstElementChild!;
    expect(ctaLabels(card)).toEqual(['Demo', 'Try']);
    // cta-2 moved but the DOM node is the same instance.
    expect(ul.querySelector(`[${KEY_ATTRIBUTE}="cta-2"]`)).toBe(survivor);
    // cta-1 was removed, cta-3 was inserted.
    expect(ul.querySelector(`[${KEY_ATTRIBUTE}="cta-1"]`)).toBeNull();
    expect(ul.querySelector(`[${KEY_ATTRIBUTE}="cta-3"]`)).not.toBeNull();
  });

  it('forgets removed items so they cannot leak stale state', () => {
    const prev = [
      {
        id: 1,
        title: 'Card A',
        ctas: [{ id: 'cta-1', label: 'old' }],
      },
    ];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray([], prev),
      nextItems: prev,
    });
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray(prev, []),
      nextItems: [],
    });
    expect(ul.children).toHaveLength(0);

    // Re-insert the same id; the nested array must render fresh, not
    // diff against the stale value we forgot.
    const reborn = [
      {
        id: 1,
        title: 'Reborn',
        ctas: [{ id: 'cta-new', label: 'fresh' }],
      },
    ];
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray([], reborn),
      nextItems: reborn,
    });
    const card = ul.firstElementChild!;
    expect(ctaLabels(card)).toEqual(['fresh']);
    expect(ul.querySelector(`[${KEY_ATTRIBUTE}="cta-1"]`)).toBeNull();
  });

  it('rebuilds nested slots on block-type replace (different shape)', () => {
    const prev = [
      {
        id: 1,
        blockType: 'callout',
        title: 'Callout',
        ctas: [{ id: 'cta-1', label: 'Buy' }],
      },
    ];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray([], prev),
      nextItems: prev,
    });

    const next = [
      {
        id: 1,
        blockType: 'feature',
        title: 'Feature',
        ctas: [{ id: 'cta-9', label: 'Brand new' }],
      },
    ];
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray(prev, next),
      nextItems: next,
    });
    const card = ul.firstElementChild!;
    expect(ctaLabels(card)).toEqual(['Brand new']);
    expect(ul.querySelector(`[${KEY_ATTRIBUTE}="cta-9"]`)).not.toBeNull();
    expect(ul.querySelector(`[${KEY_ATTRIBUTE}="cta-1"]`)).toBeNull();
  });

  it('handles items where the nested key is missing or empty', () => {
    const next = [{ id: 1, title: 'No CTAs' }];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: ITEM_TEMPLATE,
      container: ul,
      patches: diffArray([], next),
      nextItems: next,
    });
    const slot = ul.firstElementChild!.querySelector('[data-payload-nested-key="ctas"]')!;
    expect(slot.children).toHaveLength(0);
  });

  it('supports deeply nested arrays (3 levels)', () => {
    const deepTemplate =
      '<li>{{title}}<ul data-payload-nested-key="sections" ' +
      'data-payload-nested-template="' +
      '&lt;li&gt;{{name}}&lt;ul data-payload-nested-key=&quot;items&quot; ' +
      'data-payload-nested-template=&quot;&amp;lt;span&amp;gt;{{label}}&amp;lt;/span&amp;gt;&quot;&gt;&lt;/ul&gt;&lt;/li&gt;' +
      '"></ul></li>';
    const next = [
      {
        id: 'root',
        title: 'Root',
        sections: [
          {
            id: 's1',
            name: 'Sec 1',
            items: [
              { id: 'i1', label: 'one' },
              { id: 'i2', label: 'two' },
            ],
          },
        ],
      },
    ];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: deepTemplate,
      container: ul,
      patches: diffArray([], next),
      nextItems: next,
    });
    const i1 = ul.querySelector(`[${KEY_ATTRIBUTE}="i1"]`);
    const i2 = ul.querySelector(`[${KEY_ATTRIBUTE}="i2"]`);
    expect(i1?.textContent).toBe('one');
    expect(i2?.textContent).toBe('two');
  });
});

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

describe('applyStructuralPatches — document ownership', () => {
  it('parses rendered roots with the container ownerDocument', () => {
    const targetDocument = document.implementation.createHTMLDocument('structural target');
    const createElement = vi.spyOn(targetDocument, 'createElement');
    const container = targetDocument.createElement('ul');
    createElement.mockClear();

    try {
      const next = [{ id: 'target', label: 'Owned' }];
      expect(
        applyStructuralPatches({
          store,
          template: '<li>{{label}}</li>',
          container,
          patches: diffArray([], next),
          nextItems: next,
        }),
      ).toBe(true);

      expect(createElement).toHaveBeenCalledWith('template');
      expect(container.firstElementChild?.ownerDocument).toBe(targetDocument);
    } finally {
      createElement.mockRestore();
    }
  });
});

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
