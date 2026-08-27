/**
 * Island interoperability (roadmap 1.3.0).
 *
 * A hydrated framework island owns its subtree: React, Vue or Svelte will
 * re-render it from their own state, and a text node this runtime patched
 * is a text node the framework will overwrite — or, worse, a node it no
 * longer recognises. So the runtime refuses to patch inside an island by
 * default, and hands the island the data instead: every flush dispatches
 * `payload-live-preview:update` on each island root, with the update's
 * fields, revision and `receivedAt` in `detail`. The island's own code —
 * a `useEffect`, an `onMount`, a custom-element callback — decides what to
 * do with it. An island that uses Payload's official `useLivePreview` hook
 * needs nothing from here: the admin's `postMessage` reaches the window the
 * island lives in, and this runtime never touches the island's DOM.
 *
 * Island roots are `astro-island` and any element marked
 * `data-payload-island`. An island that wants the runtime's patching inside
 * it after all opts in with `data-payload-island="patch"`.
 *
 * @module @core/islands
 */

export const ISLAND_EVENT = 'payload-live-preview:update';
export const ISLAND_SELECTOR = 'astro-island, [data-payload-island]';

/** What an island receives on every applied update. */
export interface IslandUpdateDetail {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly revision: number;
  readonly receivedAt: number;
  readonly locale: string | undefined;
}

function isIslandRoot(element: Element): boolean {
  return (
    element.tagName.toLowerCase() === 'astro-island' || element.hasAttribute('data-payload-island')
  );
}

function islandAllowsPatching(island: Element): boolean {
  return island.getAttribute('data-payload-island') === 'patch';
}

/**
 * Whether `element` sits inside an island that has not opted into patching.
 * The element itself may be an island root: a binding on the root is the
 * island's own concern, not the runtime's.
 */
export function isInsideIsland(element: Element): boolean {
  let current: Element | null = element;
  while (current !== null) {
    if (isIslandRoot(current) && !islandAllowsPatching(current)) return true;
    current = current.parentElement;
  }
  return false;
}

/** Dispatch one update to every island root under `root`. Islands that opted into patching are skipped: they got the DOM. */
export function dispatchIslandUpdate(root: ParentNode, detail: IslandUpdateDetail): number {
  let delivered = 0;
  for (const island of root.querySelectorAll(ISLAND_SELECTOR)) {
    if (islandAllowsPatching(island)) continue;
    island.dispatchEvent(
      new CustomEvent<IslandUpdateDetail>(ISLAND_EVENT, { detail, bubbles: false }),
    );
    delivered += 1;
  }
  return delivered;
}
