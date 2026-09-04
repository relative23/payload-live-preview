import { beforeEach, describe, expect, it } from 'vitest';
import { ElementCache } from '@core/cache';

/** What the cache resolves once at build so the update loop never walks the DOM. */

beforeEach(() => {
  document.body.innerHTML = `
    <head-like><title data-payload-field="title">t</title></head-like>
    <section data-payload-fragment="hero">
      <h1 data-payload-field="hero.title">h</h1>
      <p data-payload-field="hero.body" data-payload-strategy="patch">b</p>
    </section>
    <p data-payload-field="note" data-payload-strategy="route" data-payload-depends="hero.title, title">n</p>
    <p data-payload-field="odd" data-payload-strategy="magic">?</p>
    <astro-island><span data-payload-field="inside">i</span></astro-island>
    <div data-payload-island="patch"><span data-payload-field="patched">p</span></div>
  `;
});

describe('ElementCache resolution', () => {
  it('resolves the strategy kind and the enclosing fragment boundary per binding', () => {
    const cache = new ElementCache();
    cache.buildFromRoot(document.body);
    const boundary = document.querySelector('[data-payload-fragment]');
    expect(cache.get('hero.title')?.[0]).toMatchObject({ strategyKind: 'fragment' });
    expect(cache.get('hero.title')?.[0]?.fragmentBoundary).toBe(boundary);
    expect(cache.get('hero.body')?.[0]).toMatchObject({ strategyKind: 'patch' });
    expect(cache.get('hero.body')?.[0]?.fragmentBoundary).toBe(boundary);
    expect(cache.get('note')?.[0]).toMatchObject({ strategyKind: 'route' });
    expect(cache.get('note')?.[0]?.fragmentBoundary).toBeUndefined();
    expect(cache.get('odd')?.[0]).toMatchObject({ strategyKind: 'unknown', strategy: 'magic' });
  });

  it('collects island roots that did not opt into patching', () => {
    const cache = new ElementCache();
    cache.buildFromRoot(document.body);
    expect(cache.islands.map((island) => island.tagName.toLowerCase())).toEqual(['astro-island']);
    cache.clear();
    expect(cache.islands).toEqual([]);
  });

  it('memoises the dependency map until the cache changes and keeps the element count current', () => {
    const cache = new ElementCache();
    cache.buildFromRoot(document.body);
    const first = cache.dependencyMap();
    expect(first).toEqual({ 'hero.title': ['note'], title: ['note'] });
    expect(cache.dependencyMap()).toBe(first);
    const count = cache.elementCount;
    const extra = document.createElement('p');
    extra.setAttribute('data-payload-field', 'extra');
    extra.setAttribute('data-payload-depends', 'title');
    document.body.append(extra);
    cache.add(extra);
    expect(cache.elementCount).toBe(count + 1);
    expect(cache.dependencyMap()).not.toBe(first);
    expect(cache.dependencyMap()).toEqual({ 'hero.title': ['note'], title: ['note', 'extra'] });
    cache.remove(extra);
    expect(cache.elementCount).toBe(count);
    expect(cache.dependencyMap()).toEqual(first);
  });
});
