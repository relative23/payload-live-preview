/**
 * `payload-live-preview/fragment` — the fragment strategy (ADR 0011).
 *
 * The core carries only a seam (`@core/strategies`); this module owns the
 * orchestration: which `data-payload-fragment` boundaries an update
 * touches, one request per boundary and revision, dedupe, a concurrency
 * cap, timeouts, response validation, and the mapping of every failure to
 * an `LP08xx` outcome so the runtime patches the boundary instead of
 * showing stale content as current. It never sends code, paths or
 * templates. Patch-only pages never load it.
 *
 * @module payload-live-preview/fragment
 */
import type { DiagnosticCode } from '@core/diagnostic-codes';
import { isInsideIsland } from '@core/islands';
import { parseDependencyList } from '@core/dependencies';
import {
  FRAGMENT_ATTRIBUTE,
  type FragmentContext,
  type FragmentReport,
  type FragmentStrategy,
} from '@core/strategies';
import {
  FRAGMENT_PROTOCOL_VERSION,
  FRAGMENT_VERSION_HEADER,
  parseFragmentResponse,
  type FragmentRequestBody,
} from '@/types/fragment-protocol';

export type {
  FragmentContext,
  FragmentReport,
  FragmentStrategy,
  RouteContext,
  RouteStrategy,
  StrategyHandlers,
  UpdateSource,
} from '@core/strategies';
export { FRAGMENT_ATTRIBUTE, resolveStrategy } from '@core/strategies';
// A fragment failure carries an LP08xx code consumers branch on.
export { DIAGNOSTIC_CODES, type DiagnosticCode } from '@core/diagnostic-codes';
export {
  createRouteStrategy,
  isRouteBound,
  ROUTE_REFRESH_HEADER,
  type RouteStrategyOptions,
} from './route';
export {
  FRAGMENT_PROTOCOL_VERSION,
  FRAGMENT_VERSION_HEADER,
  parseFragmentRequest,
  parseFragmentResponse,
  type FragmentRequestBody,
  type FragmentResponseBody,
} from '@/types/fragment-protocol';

/** Optional stable key when one registry id renders several boundaries on a page. */
export const FRAGMENT_KEY_ATTRIBUTE = 'data-payload-fragment-key';
const DEPENDS_ATTRIBUTE = 'data-payload-depends';

export interface FragmentBoundary {
  readonly element: Element;
  /** Registry id — never a path, module or function name. */
  readonly id: string;
  /** Distinguishes several boundaries of the same id on one page. */
  readonly key: string | undefined;
  /** Fields whose change re-renders the boundary; empty means any field. */
  readonly dependsOn: readonly string[];
}

/** One revision's request to a per-boundary handler. */
export interface StrategyRequest {
  readonly revision: number;
  readonly receivedAt: number;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly locale: string | undefined;
  readonly collectionSlug: string | undefined;
  readonly globalSlug: string | undefined;
  /** Aborted when a newer revision arrives or the runtime stops. */
  readonly signal: AbortSignal;
}

export type FragmentOutcome =
  | {
      readonly status: 'rendered';
      /** The boundary's new inner HTML, rendered by the registered server renderer. */
      readonly html: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | { readonly status: 'failed'; readonly code: DiagnosticCode; readonly reason: string }
  | { readonly status: 'superseded' };

/** Renders one boundary for one revision. Must honour `request.signal`. */
export type FragmentHandler = (
  request: StrategyRequest,
  boundary: FragmentBoundary,
) => Promise<FragmentOutcome>;

/** Read a boundary element's declaration. */
export function describeBoundary(element: Element): FragmentBoundary | null {
  const id = element.getAttribute(FRAGMENT_ATTRIBUTE);
  if (id === null || id.length === 0) return null;
  const key = element.getAttribute(FRAGMENT_KEY_ATTRIBUTE);
  return {
    element,
    id,
    key: key === null || key.length === 0 ? undefined : key,
    dependsOn: parseDependencyList(element.getAttribute(DEPENDS_ATTRIBUTE)),
  };
}

/**
 * The boundaries under `root` that `changedFields` touch. A boundary with no
 * `data-payload-depends` re-renders on every update; one inside an island is
 * the island's business and is never listed.
 */
export function collectFragmentBoundaries(
  root: ParentNode,
  changedFields: ReadonlySet<string>,
): readonly FragmentBoundary[] {
  const boundaries: FragmentBoundary[] = [];
  for (const element of root.querySelectorAll(`[${FRAGMENT_ATTRIBUTE}]`)) {
    const boundary = describeBoundary(element);
    if (boundary === null || isInsideIsland(element)) continue;
    if (
      boundary.dependsOn.length > 0 &&
      !boundary.dependsOn.some((field) => changedFields.has(field))
    ) {
      continue;
    }
    boundaries.push(boundary);
  }
  return boundaries;
}

/**
 * Turn a per-boundary handler into the strategy the runtime drives: plan
 * the boundaries, render each, morph a success, patch a failure, and keep
 * the revision discipline (a late or aborted render is dropped, never
 * applied).
 */
export function fragmentStrategyFrom(handler: FragmentHandler): FragmentStrategy {
  return {
    plan: (root, changedFields) =>
      collectFragmentBoundaries(root, changedFields).map((boundary) => boundary.element),
    async render(context: FragmentContext, elements: readonly Element[]): Promise<FragmentReport> {
      const report = { rendered: 0, failed: 0, superseded: 0 };
      const request: StrategyRequest = {
        revision: context.revision,
        receivedAt: context.receivedAt,
        fields: context.fields,
        locale: context.locale,
        collectionSlug: context.collectionSlug,
        globalSlug: context.globalSlug,
        signal: context.signal,
      };
      await Promise.all(
        elements.map(async (element) => {
          const boundary = describeBoundary(element);
          if (boundary === null) return;
          let outcome: FragmentOutcome;
          try {
            outcome = await handler(request, boundary);
          } catch (error) {
            outcome = {
              status: 'failed',
              code: 'LP0801',
              reason: error instanceof Error ? error.message : String(error),
            };
          }
          if (!context.isCurrent() || outcome.status === 'superseded') {
            report.superseded += 1;
            context.log(
              'LP0804',
              `fragment "${boundary.id}" for revision ${String(request.revision)} discarded as superseded`,
            );
            return;
          }
          if (outcome.status === 'rendered') {
            context.morph(element, outcome.html);
            context.rendered(element, boundary.id, boundary.key);
            report.rendered += 1;
            return;
          }
          context.failed(element, boundary.id, boundary.key, outcome.code, outcome.reason);
          if (context.isCurrent()) context.patch(element);
          report.failed += 1;
        }),
      );
      return report;
    },
  };
}

export interface FragmentStrategyOptions {
  /** Same-origin path of the fragment endpoint, e.g. `/payload/fragment`. */
  readonly endpoint: string;
  /** `fetch` to use; defaults to the global one. */
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Per-request timeout. Default 5000 ms. */
  readonly timeoutMs?: number;
  /** Requests in flight at once; further boundaries wait. Default 4. */
  readonly maxConcurrent?: number;
  /** Largest response body accepted. Default 512 KiB. */
  readonly maxResponseBytes?: number;
  /** Extra request headers, e.g. a CSRF token the site already uses. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Where the page lives; defaults to `location`. */
  readonly location?: {
    readonly pathname: string;
    readonly search: string;
  };
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;

function failed(code: DiagnosticCode, reason: string): FragmentOutcome {
  return { status: 'failed', code, reason };
}

/** A tiny semaphore: at most `limit` callers run at once, the rest queue in order. */
function createGate(limit: number): <T>(run: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };
  return async (run) => {
    if (active >= limit) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    active += 1;
    try {
      return await run();
    } finally {
      release();
    }
  };
}

/** The per-boundary HTTP handler: one POST to the endpoint, validated and bounded. */
export function createFragmentHandler(options: FragmentStrategyOptions): FragmentHandler {
  const endpoint = options.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/') || endpoint.startsWith('//')) {
    throw new TypeError(
      'createFragmentStrategy: endpoint must be a same-origin path starting with "/"',
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const gate = createGate(Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT));
  const inFlight = new Map<string, Promise<FragmentOutcome>>();

  return (request, boundary) => {
    // Identical boundary and revision share one request (two elements with
    // the same id and key render the same HTML).
    const dedupeKey = `${boundary.id} ${boundary.key ?? ''} ${String(request.revision)}`;
    const shared = inFlight.get(dedupeKey);
    if (shared !== undefined) return shared;
    const promise = gate(async (): Promise<FragmentOutcome> => {
      // Read through a function: the signal flips during awaits, which
      // control-flow narrowing cannot see.
      const superseded = (): boolean => request.signal.aborted;
      if (superseded()) return { status: 'superseded' };
      const where = options.location ?? location;
      const body: FragmentRequestBody = {
        fragment: boundary.id,
        ...(boundary.key !== undefined ? { key: boundary.key } : {}),
        route: where.pathname,
        search: where.search,
        revision: request.revision,
        ...(request.locale !== undefined ? { locale: request.locale } : {}),
        ...(request.collectionSlug !== undefined ? { collectionSlug: request.collectionSlug } : {}),
        ...(request.globalSlug !== undefined ? { globalSlug: request.globalSlug } : {}),
        fields: request.fields,
      };
      const controller = new AbortController();
      const onAbort = (): void => {
        controller.abort();
      };
      request.signal.addEventListener('abort', onAbort, { once: true });
      const state = { timedOut: false };
      const timer = setTimeout(() => {
        state.timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const fetchFn = options.fetch ?? fetch;
        let response: Response;
        try {
          response = await fetchFn(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              ...options.headers,
              accept: 'application/json',
              'content-type': 'application/json',
              [FRAGMENT_VERSION_HEADER]: String(FRAGMENT_PROTOCOL_VERSION),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (error) {
          if (superseded()) return { status: 'superseded' };
          if (state.timedOut) return failed('LP0801', `timeout after ${String(timeoutMs)} ms`);
          return failed('LP0801', error instanceof Error ? error.message : String(error));
        }
        if (superseded()) return { status: 'superseded' };
        if (response.status === 401 || response.status === 403) {
          return failed('LP0803', `endpoint refused the preview (${String(response.status)})`);
        }
        if (!response.ok) return failed('LP0801', `endpoint answered ${String(response.status)}`);
        const type = response.headers.get('content-type') ?? '';
        if (!type.toLowerCase().startsWith('application/json')) {
          return failed('LP0802', `unexpected content type "${type}"`);
        }
        const length = Number(response.headers.get('content-length') ?? '0');
        if (length > maxResponseBytes) return failed('LP0802', 'response exceeds the size limit');
        const text = await response.text();
        if (text.length > maxResponseBytes) {
          return failed('LP0802', 'response exceeds the size limit');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return failed('LP0802', 'response is not JSON');
        }
        const fragment = parseFragmentResponse(parsed);
        if (fragment === null) return failed('LP0802', 'response has the wrong shape');
        if (fragment.boundary.id !== boundary.id) {
          return failed('LP0802', 'response is for another boundary');
        }
        if (fragment.revision !== request.revision) return { status: 'superseded' };
        return { status: 'rendered', html: fragment.html, metadata: fragment.metadata };
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
      }
    });
    inFlight.set(dedupeKey, promise);
    void promise.finally(() => {
      inFlight.delete(dedupeKey);
    });
    return promise;
  };
}

/** The strategy for a fragment endpoint: hand it to the runtime as `strategies.fragment`. */
export function createFragmentStrategy(options: FragmentStrategyOptions): FragmentStrategy {
  return fragmentStrategyFrom(createFragmentHandler(options));
}
