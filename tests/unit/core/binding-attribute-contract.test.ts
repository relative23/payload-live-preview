import { afterEach, describe, expect, it, vi } from 'vitest';
import { BINDING_ATTRIBUTES, ElementCache, GUESSED_ATTRIBUTE } from '@core/cache';
import { FRAGMENT_ATTRIBUTE } from '@core/strategies';

/**
 * The cache reads a binding's attributes once, when it builds the entry, and
 * the mutation observer is what rebuilds it when one changes. An attribute the
 * cache reads but the observer does not watch goes stale on a mounted element
 * (`data-payload-format` did, until 2.2.1). Rather than a list to keep in step
 * by hand, the reads are recorded while the cache resolves real elements.
 */

/** Read by the cache and deliberately not watched, each with the reason. */
const EXEMPT: Readonly<Record<string, string>> = {
  [GUESSED_ATTRIBUTE]:
    'written by the runtime itself, which re-adds the binding to the cache right after (auto-bind.ts)',
  [FRAGMENT_ATTRIBUTE]:
    'a boundary is found when the cache is built; docs/bindings.md documents it as not watched',
};

/** Attribute names inside a selector such as `[data-payload-owner]`; a tag name such as `head` has none. */
function attributesInSelector(selector: string): string[] {
  return [...selector.matchAll(/\[\s*([^\s\]=~|^$*]+)/g)].map((match) => match[1]!);
}

function readsWhileResolving(elements: readonly Element[]): Set<string> {
  // Spies call through, so the cache resolves the real elements while each read is recorded.
  const getAttribute = vi.spyOn(Element.prototype, 'getAttribute');
  const hasAttribute = vi.spyOn(Element.prototype, 'hasAttribute');
  const closest = vi.spyOn(Element.prototype, 'closest');
  // An input's native type is read as a property, not through getAttribute.
  const type = vi.spyOn(HTMLInputElement.prototype, 'type', 'get');
  const cache = new ElementCache();
  try {
    for (const element of elements) cache.add(element);
    return new Set([
      ...getAttribute.mock.calls.map(([name]) => name),
      ...hasAttribute.mock.calls.map(([name]) => name),
      ...closest.mock.calls.flatMap(([selector]) => attributesInSelector(selector)),
      ...(type.mock.calls.length > 0 ? ['type'] : []),
    ]);
  } finally {
    vi.restoreAllMocks();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Bare elements: every optional attribute is absent, so each check the cache
 * makes for one is reached, and an explicit type cannot cut the heuristics short.
 */
function readsOfBareBindings(): Set<string> {
  document.body.innerHTML = `
    <section data-payload-owner="global:home" data-payload-fragment="hero">
      <p data-payload-field="title">t</p>
      <input data-payload-field="count" />
    </section>`;
  return readsWhileResolving([...document.querySelectorAll('[data-payload-field]')]);
}

describe('the attributes a cached binding is built from', () => {
  it('include every attribute the observer watches', () => {
    expect([...readsOfBareBindings()]).toEqual(expect.arrayContaining([...BINDING_ATTRIBUTES]));
  });

  it('are all watched by the observer, or exempt for a reason', () => {
    const unwatched = [...readsOfBareBindings()].filter(
      (name) => !BINDING_ATTRIBUTES.includes(name) && EXEMPT[name] === undefined,
    );
    expect(unwatched).toEqual([]);
  });

  it('exempts only attributes the cache really reads and the observer does not watch', () => {
    const read = readsOfBareBindings();
    for (const name of Object.keys(EXEMPT)) {
      expect(read.has(name), name).toBe(true);
      expect(BINDING_ATTRIBUTES.includes(name), name).toBe(false);
    }
  });
});
