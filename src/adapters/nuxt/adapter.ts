/**
 * Nuxt 3 / Nitro adapter: the server handler decides before the Vue app
 * renders so pages can read the verdict, and the `render:html` plugin applies
 * it. Nitro and H3 are duck-typed so this compiles without the peers.
 */

import {
  buildPreviewCsp,
  createPreviewPolicy,
  normalizeCspMode,
  type PreviewDecision,
  type PreviewPolicy,
} from '@adapters/shared/policy';
import { applyCspHeaders, bindDecisionHooks, renderScriptTag } from '@adapters/shared/response';
import { exposeDecision } from '@adapters/shared/locals';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import type { PreviewRequestLike } from '@adapters/shared/preview-request';

export type { PreviewAdapterOptions } from '@adapters/shared/options';
export type { LivePreviewLocals } from '@adapters/shared/locals';

export type LivePreviewNuxtOptions = PreviewAdapterOptions<PreviewRequestLike>;

interface HeadersLike {
  get(name: string): string | null;
  set?(name: string, value: string): void;
}
type NodeHeaderValue = string | number | string[] | undefined;
interface NodeRequestLike {
  readonly url?: string;
  readonly headers?: Record<string, string | string[] | undefined>;
}
interface NodeResponseLike {
  getHeader?: (name: string) => NodeHeaderValue;
  setHeader?: (name: string, value: string) => void;
}

/** An H3 event as v1 (`node.req`/`node.res`) or v2 (`req: Request`, `res.headers`) shapes it. */
interface H3EventLike {
  readonly path?: string;
  readonly url?: { readonly href: string } | string;
  readonly headers?: HeadersLike;
  readonly req?: NodeRequestLike | { readonly headers?: HeadersLike; readonly url?: string };
  readonly res?: NodeResponseLike | { readonly headers?: HeadersLike };
  readonly node?: { readonly req?: NodeRequestLike; readonly res?: NodeResponseLike };
  readonly context?: Record<string, unknown>;
}

/** The `render:html` hook payload — Nitro's `NuxtRenderHTMLContext`. */
interface RenderHtmlContextLike {
  readonly head: string[];
}

interface NitroAppLike {
  readonly hooks: {
    hook(
      name: 'render:html',
      fn: (html: RenderHtmlContextLike, context: { event: H3EventLike }) => void | Promise<void>,
    ): void;
  };
}

export type NitroHandler = (event: H3EventLike) => Promise<Response | undefined>;

/** Where the server handler leaves its decision for the plugin, on `event.context`. */
export const DECISION_CONTEXT_KEY = 'livePreviewDecision';

interface StashedDecision {
  readonly decision: PreviewDecision;
  readonly nonce: string;
}

/**
 * Nitro plugin body (`defineNitroPlugin(livePreviewNitroPlugin(...))`): on
 * `render:html` it reuses the server handler's stashed decision, or decides
 * itself, then appends the runtime and sets the CSP and cache headers.
 */
export function livePreviewNitroPlugin(
  options: LivePreviewNuxtOptions = {},
): (nitroApp: NitroAppLike) => void {
  const policy = createPreviewPolicy(options);
  return (nitroApp) => {
    nitroApp.hooks.hook('render:html', async (html, { event }) => {
      const { decision, nonce } = await decideFor(event, policy, options);
      if (!decision.isPreview) return;
      if (decision.inject) html.head.push(policy.scriptTag(nonce));
      const headers = responseHeaders(event);
      if (headers === undefined || (!decision.inject && decision.cspMode === false)) return;
      applyCspHeaders(headers, policy, decision, nonce);
    });
  };
}

/**
 * Server middleware (`defineEventHandler(defineLivePreviewServerHandler(o))`)
 * that decides before the app renders and publishes the verdict on
 * `event.context`. Give it the plugin's options; the plugin reuses its verdict.
 */
export function defineLivePreviewServerHandler(options: LivePreviewNuxtOptions = {}): NitroHandler {
  const policy = createPreviewPolicy(options);
  return async (event: H3EventLike) => {
    await decideFor(event, policy, options);
    // `undefined` tells Nitro to continue with the next handler.
    return undefined;
  };
}

async function decideFor(
  event: H3EventLike,
  policy: PreviewPolicy,
  options: LivePreviewNuxtOptions,
): Promise<StashedDecision> {
  const context: Record<string, unknown> = event.context ?? {};
  const stashed = context[DECISION_CONTEXT_KEY] as StashedDecision | undefined;
  if (stashed !== undefined) return stashed;
  const request = toPreviewRequestLike(event);
  const decision = await policy.decide(request, bindDecisionHooks(policy, options, request));
  const result: StashedDecision = { decision, nonce: policy.nonce() };
  context[DECISION_CONTEXT_KEY] = result;
  exposeDecision(context, decision, result.nonce);
  return result;
}

/** The `<script>` tag for manual insertion (`useHead()`) when `autoInject` is off. */
export function renderLivePreviewScript(
  options: LivePreviewNuxtOptions & { readonly nonce?: string } = {},
): string {
  return renderScriptTag(options);
}

/** The CSP header value for consumers that set the header themselves; it builds and never gates, so `manageCsp: false` still yields frame-ancestors. */
export function buildLivePreviewCsp(
  options: LivePreviewNuxtOptions,
  nonce: string,
  existing = '',
  mode?: 'frame-ancestors' | 'full',
): string {
  const resolved = mode ?? normalizeCspMode(options.manageCsp);
  return buildPreviewCsp(
    options,
    nonce,
    existing,
    resolved === 'full' ? 'full' : 'frame-ancestors',
  );
}

function hasGet(value: unknown): value is HeadersLike {
  return typeof (value as { get?: unknown } | undefined)?.get === 'function';
}

/** Repeated headers arrive joined with `, ` (web) or as `string[]` (Node); both become one string. */
function joinHeader(value: NodeHeaderValue): string | undefined {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return String(value);
  return value;
}

function requestHeader(event: H3EventLike, name: string): string | null {
  const web = hasGet(event.headers)
    ? event.headers
    : hasGet(event.req?.headers)
      ? event.req.headers
      : undefined;
  if (web !== undefined) return web.get(name);
  const raw = event.node?.req?.headers ?? (event.req?.headers as NodeRequestLike['headers']);
  const value = raw?.[name.toLowerCase()];
  // The intent check compares single values; the first of a repeated header is it.
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * The request shape the policy reads, from either event flavour. Nitro sets
 * `event.url` to a path on some versions, and a relative URL makes every
 * query-signal check fail to parse — so it is used only when absolute.
 */
function toPreviewRequestLike(event: H3EventLike): PreviewRequestLike {
  const host = requestHeader(event, 'host') ?? 'localhost';
  const path = event.path ?? event.node?.req?.url ?? event.req?.url ?? '/';
  const candidate = typeof event.url === 'string' ? event.url : event.url?.href;
  return {
    url: absoluteUrl(candidate) ?? `http://${host}${path}`,
    headers: { get: (name) => requestHeader(event, name) },
  };
}

function absoluteUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

/** Response headers as one sink: a Node `setHeader` response or a web `Headers`. */
function responseHeaders(
  event: H3EventLike,
): { get(name: string): string | undefined; set(name: string, value: string): void } | undefined {
  const node = event.node?.res ?? (event.res as NodeResponseLike | undefined);
  if (typeof node?.setHeader === 'function') {
    return {
      get: (name) => joinHeader(node.getHeader?.(name)),
      // Called on the response, never detached: Node's `setHeader` reads
      // `this._header` and throws when it is invoked unbound.
      set: (name, value) => {
        node.setHeader?.(name, value);
      },
    };
  }
  const web = (event.res as { headers?: HeadersLike } | undefined)?.headers;
  if (hasGet(web) && typeof web.set === 'function') {
    const set = web.set.bind(web);
    return { get: (name) => web.get(name) ?? undefined, set };
  }
  return undefined;
}
