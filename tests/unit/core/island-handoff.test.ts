/**
 * ADR 0021's island handoff, against a stand-in with the semantics read from
 * Astro 7.3.2 and @astrojs/react 6.0.6: the island observes `props`, its
 * hydrator ignores a call without `ssr`, keeps one root per element and drops
 * it on `astro:unmount`. The native suite proves the real packages.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  islandStartBlocker,
  releaseDisconnectedIslands,
  retainIslandBoundary,
} from '@core/islands';
import { morphElement, type MorphOptions } from '@core/morph';

interface Rendered {
  readonly root: number;
  readonly title: unknown;
}

let roots = 0;
const rootOf = new WeakMap<Element, number>();
const renders: Rendered[] = [];
const unmounts: Element[] = [];

class StandInIsland extends HTMLElement {
  static observedAttributes = ['props'];
  private started = false;

  start(): void {
    this.started = true;
    this.hydrate();
  }

  hydrate(): void {
    if (!this.started || !this.isConnected) return;
    const props = JSON.parse(this.getAttribute('props') ?? '{}') as Record<string, unknown>;
    // @astrojs/react returns without `ssr` and reuses the element's root.
    if (this.hasAttribute('ssr')) {
      let root = rootOf.get(this);
      if (root === undefined) {
        roots += 1;
        root = roots;
        rootOf.set(this, root);
        this.addEventListener('astro:unmount', () => unmounts.push(this), { once: true });
      }
      renders.push({ root, title: props['title'] });
    }
    this.removeAttribute('ssr');
  }

  attributeChangedCallback(): void {
    this.hydrate();
  }
}

const IDENTITY =
  'component-url="/_astro/Card.js" component-export="default" renderer-url="/_astro/client.js" client="load" opts=\'{"name":"Card","value":true}\'';

function island(title: string, extra = ''): string {
  return `<astro-island ${IDENTITY} ${extra} ssr props='{"title":"${title}"}'><h3>${title}</h3></astro-island>`;
}

function parse(html: string, owner: Document = document): Element {
  const template = owner.createElement('template');
  template.innerHTML = html.trim();
  const first = template.content.firstElementChild;
  if (first === null) throw new Error('no element');
  return owner.importNode(first, true);
}

function mountHydrated(html: string): { readonly live: Element; readonly island: StandInIsland } {
  const live = parse(html);
  document.body.append(live);
  const found = live.querySelector('astro-island');
  if (!(found instanceof StandInIsland)) throw new Error('island not upgraded');
  found.start();
  return { live, island: found };
}

/** The options the fragment, route and structural coordinators hand the engine. */
const COORDINATOR: MorphOptions = { keyAttributes: [], retainBoundary: retainIslandBoundary };

beforeAll(() => {
  customElements.define('astro-island', StandInIsland);
});

afterEach(() => {
  document.body.replaceChildren();
  roots = 0;
  renders.length = 0;
  unmounts.length = 0;
  Reflect.deleteProperty(window, 'Astro');
});

describe('Astro island handoff (ADR 0021)', () => {
  it('hands new props to a same-component island through ssr, then props, keeping its root', () => {
    const { live, island: hydrated } = mountHydrated(`<div>${island('First')}</div>`);
    expect(renders).toEqual([{ root: 1, title: 'First' }]);

    morphElement(live, parse(`<div>${island('Second')}</div>`), COORDINATOR);

    expect(live.querySelector('astro-island')).toBe(hydrated);
    expect(renders).toEqual([
      { root: 1, title: 'First' },
      { root: 1, title: 'Second' },
    ]);
    expect(hydrated.hasAttribute('ssr')).toBe(false);
    // The framework owns the subtree; the server's copy of it is not merged in.
    expect(hydrated.querySelector('h3')?.textContent).toBe('First');
  });

  it('leaves an island whose rendered props did not change completely untouched', () => {
    const { live, island: hydrated } = mountHydrated(`<div>${island('Same')}</div>`);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(hydrated, { attributes: true, childList: true, subtree: true });

    morphElement(live, parse(`<div>${island('Same')}</div>`), COORDINATOR);

    expect(observer.takeRecords().concat(mutations)).toEqual([]);
    observer.disconnect();
    expect(renders).toHaveLength(1);
  });

  it.each([
    ['component-url', '/_astro/Other.js'],
    ['component-export', 'Named'],
    ['renderer-url', '/_astro/vue-client.js'],
    ['client', 'visible'],
    ['opts', '{"name":"Card","value":"(min-width: 1px)"}'],
    ['before-hydration-url', '/_astro/before.js'],
  ])('replaces an island whose %s changed, and releases the old root once', (name, value) => {
    const { live, island: first } = mountHydrated(`<div>${island('First')}</div>`);
    const rendered = parse(`<div>${island('Second')}</div>`);
    rendered.querySelector('astro-island')?.setAttribute(name, value);
    const before = Array.from(live.querySelectorAll('astro-island'));

    morphElement(live, rendered, COORDINATOR);
    releaseDisconnectedIslands(before);
    releaseDisconnectedIslands(before);

    const replacement = live.querySelector('astro-island');
    expect(replacement).not.toBe(first);
    expect(replacement?.getAttribute(name)).toBe(value);
    expect(first.isConnected).toBe(false);
    expect(unmounts).toEqual([first]);
    expect(renders).toEqual([{ root: 1, title: 'First' }]);
  });

  it('does not release an island the morph kept connected', () => {
    const { live, island: kept } = mountHydrated(`<div>${island('Kept')}</div>`);
    morphElement(live, parse(`<div>${island('Next')}</div>`), COORDINATOR);

    releaseDisconnectedIslands([kept]);

    expect(unmounts).toEqual([]);
  });

  it('replaces an island that is not upgraded instead of changing props nobody observes', () => {
    const foreign = document.implementation.createHTMLDocument('');
    const live = parse(`<div>${island('First')}</div>`, foreign);
    const stale = live.querySelector('astro-island');

    expect(retainIslandBoundary(stale!, parse(island('Second'), foreign))).toBe(false);
    expect(stale?.getAttribute('props')).toBe('{"title":"First"}');
    expect(stale?.hasAttribute('ssr')).toBe(true);
  });

  it('replaces an island whose slot markup changed, then hands props while it stays', () => {
    const slotted = (title: string, slot: string): string =>
      island(title).replace('</astro-island>', `<astro-slot>${slot}</astro-slot></astro-island>`);
    const { live, island: first } = mountHydrated(`<div>${slotted('First', 'a')}</div>`);

    morphElement(live, parse(`<div>${slotted('First', 'b')}</div>`), COORDINATOR);
    const second = live.querySelector('astro-island');
    if (!(second instanceof StandInIsland)) throw new Error('replacement not upgraded');
    expect(second).not.toBe(first);
    second.start();
    morphElement(live, parse(`<div>${slotted('Next', 'b')}</div>`), COORDINATOR);

    expect(live.querySelector('astro-island')).toBe(second);
    expect(renders.at(-1)).toEqual({ root: 2, title: 'Next' });
  });

  it('treats a renamed slot or a changed template slot as different slot markup', () => {
    const named = (slot: string): string =>
      island('Same').replace(
        '</astro-island>',
        `<astro-slot name="${slot}">x</astro-slot></astro-island>`,
      );
    const templated = (content: string): string =>
      island('Same').replace(
        '</astro-island>',
        `<template data-astro-template="icon">${content}</template></astro-island>`,
      );
    const { live, island: first } = mountHydrated(`<div>${named('header')}</div>`);

    morphElement(live, parse(`<div>${named('footer')}</div>`), COORDINATOR);
    const renamed = live.querySelector('astro-island');
    expect(renamed).not.toBe(first);

    morphElement(live, parse(`<div>${templated('a')}</div>`), COORDINATOR);
    const templatedIsland = live.querySelector('astro-island');
    expect(templatedIsland).not.toBe(renamed);
    morphElement(live, parse(`<div>${templated('b')}</div>`), COORDINATOR);
    expect(live.querySelector('astro-island')).not.toBe(templatedIsland);
  });

  it("counts only an island's own slots, not those of an island nested inside it", () => {
    const nested = (title: string, slot: string): string =>
      island(title).replace(
        '</astro-island>',
        `<astro-island client="load"><astro-slot>${slot}</astro-slot></astro-island></astro-island>`,
      );
    const { live, island: outer } = mountHydrated(`<div>${nested('First', 'a')}</div>`);

    morphElement(live, parse(`<div>${nested('Second', 'b')}</div>`), COORDINATOR);

    expect(live.querySelector('astro-island')).toBe(outer);
    expect(renders.at(-1)).toEqual({ root: 1, title: 'Second' });
  });

  it('removes props the rendered island no longer carries, through the same handoff', () => {
    const { live, island: hydrated } = mountHydrated(`<div>${island('First')}</div>`);
    const rendered = parse(`<div>${island('ignored')}</div>`);
    rendered.querySelector('astro-island')?.removeAttribute('props');

    morphElement(live, rendered, COORDINATOR);

    expect(live.querySelector('astro-island')).toBe(hydrated);
    expect(hydrated.hasAttribute('props')).toBe(false);
    expect(renders).toEqual([
      { root: 1, title: 'First' },
      { root: 1, title: undefined },
    ]);
  });

  it('keeps every boundary pair whole when the engine is given no rule', () => {
    const { live, island: hydrated } = mountHydrated(`<div>${island('First')}</div>`);

    morphElement(live, parse(`<div>${island('Second')}</div>`), { keyAttributes: [] });

    expect(live.querySelector('astro-island')).toBe(hydrated);
    expect(hydrated.getAttribute('props')).toBe('{"title":"First"}');
    expect(renders).toEqual([{ root: 1, title: 'First' }]);
  });

  it('keeps any boundary other than an Astro island whole', () => {
    const live = parse('<x-card data-a="1"><p>live</p></x-card>');
    expect(retainIslandBoundary(live, parse('<x-card data-a="2"><p>new</p></x-card>'))).toBe(true);
    expect(live.outerHTML).toBe('<x-card data-a="1"><p>live</p></x-card>');
  });

  it('names what an inserted island is missing: the element, then its directive', () => {
    const foreign = document.implementation.createHTMLDocument('');
    expect(islandStartBlocker(parse(island('x'), foreign))).toBe('element');
    const inserted = parse(island('x'));
    expect(islandStartBlocker(inserted)).toBe('directive');
    Reflect.set(window, 'Astro', { visible: () => undefined });
    expect(islandStartBlocker(inserted)).toBe('directive');
    Reflect.set(window, 'Astro', { load: () => undefined });
    expect(islandStartBlocker(inserted)).toBeUndefined();
  });
});
