/**
 * The route strategy (roadmap 1.7.0): when a revision touches something no
 * smaller strategy can render — the document head, layout, route params,
 * global providers — the whole route is fetched again and morphed in place,
 * with scroll and focus preserved. The runtime then rescans and re-applies
 * the revision, so the editor's unsaved state lands on the fresh markup.
 *
 * Loop protection is two-fold: the runtime refreshes at most once per
 * revision (LP0805), and this strategy refuses a refresh that follows the
 * previous one within `minIntervalMs` (LP0805 as well).
 *
 * @module @fragment/route
 */
import { morphElement } from '@core/morph';
import { KEY_ATTRIBUTE } from '@core/structural-applier';
import { parseDependencyList } from '@core/dependencies';
import { FRAGMENT_ATTRIBUTE, type RouteContext, type RouteStrategy } from '@core/strategies';
import { ISLAND_ATTRIBUTE } from '@core/morph';

const STRATEGY_ATTRIBUTE = 'data-payload-strategy';
const FIELD_ATTRIBUTE = 'data-payload-field';
const DEPENDS_ATTRIBUTE = 'data-payload-depends';
/** Sent with every refresh so a server can tell a preview refresh from navigation. */
export const ROUTE_REFRESH_HEADER = 'x-payload-live-preview';

export interface RouteStrategyOptions {
  /** `fetch` to use; defaults to the global one. */
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Per-refresh timeout. Default 8000 ms. */
  readonly timeoutMs?: number;
  /** Shortest gap between two refreshes; a request inside it is refused with LP0805. Default 1000 ms. */
  readonly minIntervalMs?: number;
  /** The document to refresh; defaults to `document`. */
  readonly document?: Document;
  /** Where the page lives; defaults to `location`. */
  readonly location?: { readonly href: string };
  /** Scroll access; defaults to `window`. */
  readonly window?: {
    readonly scrollX: number;
    readonly scrollY: number;
    readonly scrollTo: (x: number, y: number) => void;
  };
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MIN_INTERVAL_MS = 1_000;

/**
 * Whether a bound element belongs to the route: an explicit
 * `data-payload-strategy="route"`, or a binding in `<head>`.
 */
export function isRouteBound(element: Element): boolean {
  const explicit = element.getAttribute(STRATEGY_ATTRIBUTE);
  if (explicit !== null) return explicit === 'route';
  return element.closest('head') !== null;
}

/** The fields an element re-renders for: its own binding plus `data-payload-depends`. */
function fieldsOf(element: Element): readonly string[] {
  const own = element.getAttribute(FIELD_ATTRIBUTE);
  const depends = parseDependencyList(element.getAttribute(DEPENDS_ATTRIBUTE));
  return own === null || own.length === 0 ? depends : [own, ...depends];
}

/** Sync `<title>`, `<meta name|property>` and `<link rel="canonical">` from the fresh document. */
function syncHead(live: Document, fresh: Document): void {
  if (fresh.title !== live.title) live.title = fresh.title;
  const keyOf = (element: Element): string | null => {
    if (element.tagName === 'META') {
      const name = element.getAttribute('name') ?? element.getAttribute('property');
      return name === null ? null : `meta:${name}`;
    }
    if (element.tagName === 'LINK' && element.getAttribute('rel') === 'canonical') {
      return 'link:canonical';
    }
    return null;
  };
  const liveByKey = new Map<string, Element>();
  for (const element of live.head.querySelectorAll('meta, link')) {
    const key = keyOf(element);
    if (key !== null) liveByKey.set(key, element);
  }
  for (const element of fresh.head.querySelectorAll('meta, link')) {
    const key = keyOf(element);
    if (key === null) continue;
    const current = liveByKey.get(key);
    if (current === undefined) {
      live.head.append(live.importNode(element, true));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (current.getAttribute(attribute.name) !== attribute.value) {
        current.setAttribute(attribute.name, attribute.value);
      }
    }
  }
}

export function createRouteStrategy(options: RouteStrategyOptions = {}): RouteStrategy {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  let lastRefreshAt = -Infinity;

  return {
    plan(root, changedFields) {
      for (const element of root.querySelectorAll(
        `[${FIELD_ATTRIBUTE}], [${STRATEGY_ATTRIBUTE}="route"]`,
      )) {
        if (!isRouteBound(element)) continue;
        const fields = fieldsOf(element);
        if (fields.length === 0 || fields.some((field) => changedFields.has(field))) return true;
      }
      return false;
    },
    async refresh(context: RouteContext) {
      const now = Date.now();
      if (now - lastRefreshAt < minIntervalMs) {
        context.log(
          'LP0805',
          `route refresh for revision ${String(context.revision)} refused: the previous one was ${String(now - lastRefreshAt)} ms ago`,
        );
        return 'failed';
      }
      lastRefreshAt = now;
      const live = options.document ?? document;
      const where = options.location ?? location;
      const view = options.window ?? window;
      const controller = new AbortController();
      const onAbort = (): void => {
        controller.abort();
      };
      context.signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const fetchFn = options.fetch ?? fetch;
        let response: Response;
        try {
          response = await fetchFn(where.href, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'text/html', [ROUTE_REFRESH_HEADER]: 'route' },
            signal: controller.signal,
          });
        } catch (error) {
          if (context.signal.aborted) return 'superseded';
          context.log('LP0801', error instanceof Error ? error.message : String(error));
          return 'failed';
        }
        if (context.signal.aborted) return 'superseded';
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) {
          context.log(
            'LP0802',
            `route answered ${String(response.status)} ${response.headers.get('content-type') ?? ''}`,
          );
          return 'failed';
        }
        const html = await response.text();
        if (!context.isCurrent()) return 'superseded';
        const fresh = new DOMParser().parseFromString(html, 'text/html');
        const x = view.scrollX;
        const y = view.scrollY;
        syncHead(live, fresh);
        // The body is morphed in place: islands and custom elements are
        // boundaries the morph does not cross, focus and typed values stay.
        // Fragment boundaries keep their current children too — the fragment
        // strategy owns them and re-renders them for this revision, so the
        // route must not replace the focused input inside one.
        // Key the top-level boundaries so they pair by identity, not by
        // position: a full-document morph must not mispair the fragment
        // section or an island because of a comment, whitespace or a runtime-
        // added node among the body's children.
        morphElement(live.body, fresh.body, {
          keyAttributes: [KEY_ATTRIBUTE, FRAGMENT_ATTRIBUTE, ISLAND_ATTRIBUTE],
          retainChildrenOf: (element) => element.hasAttribute(FRAGMENT_ATTRIBUTE),
        });
        view.scrollTo(x, y);
        return 'refreshed';
      } finally {
        clearTimeout(timer);
        context.signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
