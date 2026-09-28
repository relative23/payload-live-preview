/**
 * Hydrated islands own their subtree, so the runtime never patches inside one.
 * Instead every flush that carried a change dispatches `payload-live-preview:update`
 * on each island root with the update in `detail`, whether or not a binding
 * outside the islands was written. `data-payload-island="patch"` opts back in.
 * Server HTML reaches an Astro island only through Astro's own props handoff
 * (ADR 0021). @internal
 */

export const ISLAND_EVENT = 'payload-live-preview:update';
/** @internal */
export const ISLAND_ATTRIBUTE = 'data-payload-island';
export const ISLAND_SELECTOR = `astro-island, [${ISLAND_ATTRIBUTE}]`;
/** The opt-out for a subtree the site scripts itself: the morph never enters it. @internal */
export const OWNED_ATTRIBUTE = 'data-payload-owned';

/**
 * The ownership rule (ADR 0008 §4): a subtree the morph never enters. Custom
 * elements own their subtree, islands are a framework's, `contenteditable`
 * is the visitor's, `data-payload-owned` is the site's. The coordinators hand
 * this rule to the engine as `MorphOptions.boundary`; the engine itself only
 * pairs, edits and keeps focus (§9). @beta
 */
export function isMorphBoundary(element: Element): boolean {
  if (element.tagName.toLowerCase().includes('-')) return true;
  if (isIslandBoundary(element) || element.hasAttribute(OWNED_ATTRIBUTE)) return true;
  const editable = element.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

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

/** Astro keeps `ssr` until the framework listener has finished hydrating. @internal */
export function isAwaitingIslandHydration(island: Element): boolean {
  return island.tagName.toLowerCase() === 'astro-island' && island.hasAttribute('ssr');
}

export function dispatchIslandUpdate(
  islands: readonly Element[],
  detail: IslandUpdateDetail,
  isCurrent: () => boolean,
): number {
  let dispatched = 0;
  for (const island of islands) {
    if (!isCurrent()) break;
    island.dispatchEvent(
      new CustomEvent<IslandUpdateDetail>(ISLAND_EVENT, { detail, bubbles: false }),
    );
    dispatched += 1;
    if (!isCurrent()) break;
  }
  return dispatched;
}

/** What decides whether a live `astro-island` still renders the rendered one's component (ADR 0021). */
const ISLAND_IDENTITY = [
  'component-url',
  'component-export',
  'renderer-url',
  'client',
  'opts',
  'before-hydration-url',
] as const;
/** Slot markup each island was last rendered with; Astro reads slots once, at hydration. */
const renderedSlots = new WeakMap<Element, string>();
const unmountedIslands = new WeakSet<Element>();

function isAstroIsland(element: Element): boolean {
  return element.tagName.toLowerCase() === 'astro-island';
}

function slotMarkup(island: Element): string {
  let markup = '';
  for (const slot of island.querySelectorAll('astro-slot, template[data-astro-template]')) {
    if (slot.parentElement?.closest('astro-island') !== island) continue;
    const name = slot.getAttribute('name') ?? slot.getAttribute('data-astro-template') ?? '';
    markup += `${name}\u0000${slot.innerHTML}\u0000`;
  }
  return markup;
}

/** Only an upgraded island whose class observes `props` re-hydrates in place. */
function observesProps(island: Element): boolean {
  const constructor = island.ownerDocument.defaultView?.customElements.get('astro-island') as
    (CustomElementConstructor & { readonly observedAttributes?: unknown }) | undefined;
  return (
    constructor !== undefined &&
    island instanceof constructor &&
    Array.isArray(constructor.observedAttributes) &&
    constructor.observedAttributes.includes('props')
  );
}

/**
 * The package's decision for a boundary pair (ADR 0021). A boundary other than
 * an Astro island stays whole (ADR 0008 §4). An island that still renders the
 * same component, with the same slots, keeps its framework state: it takes the
 * rendered props the way Astro's router hands them to a persisted island,
 * `ssr` first, then `props`. Anything else is replaced, and hydrates fresh.
 * @beta
 */
export function retainIslandBoundary(live: Element, rendered: Element): boolean {
  if (!isAstroIsland(live) || !isAstroIsland(rendered)) return true;
  const slots = slotMarkup(rendered);
  const retained =
    ISLAND_IDENTITY.every((name) => live.getAttribute(name) === rendered.getAttribute(name)) &&
    (renderedSlots.get(live) ?? slotMarkup(live)) === slots &&
    (live.getAttribute('props') === rendered.getAttribute('props') || observesProps(live));
  if (!retained) {
    renderedSlots.set(rendered, slots);
    return false;
  }
  renderedSlots.set(live, slots);
  const props = rendered.getAttribute('props');
  if (props !== live.getAttribute('props')) {
    live.setAttribute('ssr', '');
    if (props === null) live.removeAttribute('props');
    else live.setAttribute('props', props);
  }
  return true;
}

/** The Astro islands under `root`, to compare before and after a morph. @internal */
export function astroIslandsIn(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('astro-island'));
}

/**
 * Astro's framework clients release their roots on `astro:unmount`, which its
 * router sends after a swap. A morph that disconnects an island sends it once
 * itself, so a removed React root does not outlive its markup. @internal
 */
export function releaseDisconnectedIslands(islands: readonly Element[]): void {
  for (const island of islands) {
    if (island.isConnected || unmountedIslands.has(island)) continue;
    unmountedIslands.add(island);
    island.dispatchEvent(new CustomEvent('astro:unmount'));
  }
}

/**
 * Why an inserted island cannot start: fragment scripts never run, so the page
 * itself must have loaded Astro's island element and this client directive.
 * @internal
 */
export function islandStartBlocker(island: Element): 'element' | 'directive' | undefined {
  const view = island.ownerDocument.defaultView;
  if (view?.customElements.get('astro-island') === undefined) return 'element';
  const directive = island.getAttribute('client');
  const astro: unknown = Reflect.get(view, 'Astro');
  if (directive === null || typeof astro !== 'object' || astro === null) return 'directive';
  return Reflect.get(astro, directive) === undefined ? 'directive' : undefined;
}
