import { describe, expect, it } from 'vitest';
import { applyStructuralPatches, KEY_ATTRIBUTE } from '@core/structural-applier';
import { diffArray } from '@schema/diff';
import { store } from './structural-applier-harness';

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
});
