/**
 * Hydrated islands own their subtree, so the runtime never patches inside one.
 * Instead every flush that carried a change dispatches `payload-live-preview:update`
 * on each island root with the update in `detail`, whether or not a binding
 * outside the islands was written. `data-payload-island="patch"` opts back in.
 * @internal
 */

export const ISLAND_EVENT = 'payload-live-preview:update';
/** @internal */
export const ISLAND_ATTRIBUTE = 'data-payload-island';
export const ISLAND_SELECTOR = `astro-island, [${ISLAND_ATTRIBUTE}]`;

export interface IslandUpdateDetail {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly revision: number;
  readonly receivedAt: number;
  readonly locale: string | undefined;
}

function isIslandRoot(element: Element): boolean {
  return element.tagName.toLowerCase() === 'astro-island' || element.hasAttribute(ISLAND_ATTRIBUTE);
}

function islandAllowsPatching(island: Element): boolean {
  return island.getAttribute(ISLAND_ATTRIBUTE) === 'patch';
}

/** Whether `element` itself is an island root that did not opt into patching. */
export function isIslandBoundary(element: Element): boolean {
  return isIslandRoot(element) && !islandAllowsPatching(element);
}

/** Whether `element` (or an ancestor) is an island that did not opt into patching. @internal */
export function isInsideIsland(element: Element): boolean {
  let current: Element | null = element;
  while (current !== null) {
    if (isIslandBoundary(current)) return true;
    current = current.parentElement;
  }
  return false;
}

/** Island roots under `root` that receive update events. */
export function collectIslands(root: ParentNode): Element[] {
  const islands: Element[] = [];
  for (const island of root.querySelectorAll(ISLAND_SELECTOR)) {
    if (!islandAllowsPatching(island)) islands.push(island);
  }
  return islands;
}

export function dispatchIslandUpdate(
  islands: readonly Element[],
  detail: IslandUpdateDetail,
): number {
  for (const island of islands) {
    island.dispatchEvent(
      new CustomEvent<IslandUpdateDetail>(ISLAND_EVENT, { detail, bubbles: false }),
    );
  }
  return islands.length;
}
