/**
 * The route strategy: when a revision touches what no smaller strategy can
 * render, fetch the route again and morph it in place. A refresh inside
 * `minIntervalMs` is refused as LP0805. See ADR 0011.
 */

import { morphElement, OWNED_ATTRIBUTE } from '@core/morph';
import { KEY_ATTRIBUTE } from '@core/structural-applier';
import { parseDependencyList } from '@core/dependencies';
import { FRAGMENT_ATTRIBUTE, type RouteContext, type RouteStrategy } from '@core/strategies';
import { errorMessage, linkedTimeout } from './abort';
import { FRAGMENT_KEY_ATTRIBUTE } from './boundary';

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
  /** Shortest gap between two refreshes; one inside it is refused with LP0805. Default 1000 ms. */
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

/** An explicit `data-payload-strategy="route"`, or a binding in `<head>`. */
export function isRouteBound(element: Element): boolean {
  const explicit = element.getAttribute(STRATEGY_ATTRIBUTE);
  if (explicit !== null) return explicit === 'route';
  return element.closest('head') !== null;
}

function fieldsOf(element: Element): readonly string[] {
  const own = element.getAttribute(FIELD_ATTRIBUTE);
  const depends = parseDependencyList(element.getAttribute(DEPENDS_ATTRIBUTE));
  return own === null || own.length === 0 ? depends : [own, ...depends];
}

function headKeyOf(element: Element): string | null {
  if (element.tagName === 'META') {
    const name = element.getAttribute('name') ?? element.getAttribute('property');
    return name === null ? null : `meta:${name}`;
  }
  if (element.tagName === 'LINK' && element.getAttribute('rel') === 'canonical') {
    return 'link:canonical';
  }
  return null;
}

/**
 * Make `<title>`, named `<meta>` and the canonical `<link>` match the fresh
 * head, removals included — it is the server's own render of this URL. A tag
 * marked `data-payload-owned` belongs to a script and is left alone.
 */
function syncHead(live: Document, fresh: Document): void {
  if (fresh.title !== live.title) live.title = fresh.title;
  const liveByKey = new Map<string, Element>();
  for (const element of live.head.querySelectorAll('meta, link')) {
    const key = headKeyOf(element);
    if (key !== null && !liveByKey.has(key)) liveByKey.set(key, element);
  }
  const freshKeys = new Set<string>();
  for (const element of fresh.head.querySelectorAll('meta, link')) {
    const key = headKeyOf(element);
    if (key === null) continue;
    freshKeys.add(key);
    const current = liveByKey.get(key);
    if (current === undefined) {
      live.head.append(live.importNode(element, true));
      continue;
    }
    if (current.hasAttribute(OWNED_ATTRIBUTE)) continue;
    for (const attribute of Array.from(element.attributes)) {
      if (current.getAttribute(attribute.name) !== attribute.value) {
        current.setAttribute(attribute.name, attribute.value);
      }
    }
  }
  for (const [key, element] of liveByKey) {
    if (!freshKeys.has(key) && !element.hasAttribute(OWNED_ATTRIBUTE)) element.remove();
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
      const timeout = linkedTimeout(context.signal, timeoutMs);
      const failure = (error: unknown): 'failed' | 'superseded' => {
        if (context.signal.aborted) return 'superseded';
        // A timeout surfaces as an AbortError whose text differs per browser.
        const detail = timeout.timedOut()
          ? `route refresh timed out after ${String(timeoutMs)} ms`
          : errorMessage(error);
        context.log('LP0801', detail);
        return 'failed';
      };
      try {
        let response: Response;
        try {
          response = await (options.fetch ?? fetch)(where.href, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'text/html', [ROUTE_REFRESH_HEADER]: 'route' },
            signal: timeout.signal,
          });
        } catch (error) {
          return failure(error);
        }
        if (context.signal.aborted) return 'superseded';
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) {
          context.log(
            'LP0802',
            `route answered ${String(response.status)} ${response.headers.get('content-type') ?? ''}`,
          );
          return 'failed';
        }
        try {
          const html = await response.text();
          if (!context.isCurrent()) return 'superseded';
          const fresh = new DOMParser().parseFromString(html, 'text/html');
          const x = view.scrollX;
          const y = view.scrollY;
          syncHead(live, fresh);
          // Top-level boundaries pair by identity so a comment or a runtime-added
          // node cannot mispair them; fragment boundaries keep their children —
          // the fragment strategy re-renders those for this revision and must
          // not lose the focused input inside one.
          morphElement(live.body, fresh.body, {
            keyAttributes: [KEY_ATTRIBUTE, FRAGMENT_KEY_ATTRIBUTE, FRAGMENT_ATTRIBUTE],
            retainChildrenOf: (element) => element.hasAttribute(FRAGMENT_ATTRIBUTE),
          });
          view.scrollTo(x, y);
          return 'refreshed';
        } catch (error) {
          return failure(error);
        }
      } finally {
        timeout.dispose();
      }
    },
  };
}
