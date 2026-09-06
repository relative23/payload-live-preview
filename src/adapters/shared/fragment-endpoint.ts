/**
 * The fragment endpoint, without a component system (ADR 0011): it renders a
 * registered boundary from unsaved form state for an authorized preview, and
 * nothing else. The browser names a registry id; the server decides what that
 * id renders.
 *
 * Everything here is framework-neutral — method and origin checks, the body
 * limit, the protocol, authorization, the registry lookup, the timeouts and the
 * response shape. An adapter binds one renderer to it and exports the result;
 * `src/adapters/astro/fragments.ts` and `src/adapters/nextjs/fragments.ts` are
 * the two, and each is a few dozen lines because this file is the endpoint.
 */
import {
  authorizePreviewRequest,
  type PreviewAuthorizationStrategy,
} from '@security/preview-authorization';
import type { PreviewAuthorization } from '@security/preview-verdict';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
import { runAuthorizeHook } from './authorize-hook';
import { warnOnce } from './dev-warning';
import type { PreviewAdapterOptions } from './options';
import {
  FRAGMENT_PROTOCOL_VERSION,
  FRAGMENT_VERSION_HEADER,
  parseFragmentRequest,
  type FragmentRequestBody,
  type FragmentResponseBody,
} from '@/types/fragment-protocol';

/** Everything a registry entry may use to compute its props. */
export interface FragmentRenderInput {
  readonly id: string;
  readonly key: string | undefined;
  readonly revision: number;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly locale: string | undefined;
  readonly collectionSlug: string | undefined;
  readonly globalSlug: string | undefined;
  readonly route: string;
  readonly authorization: AuthorizedPreviewContext;
  readonly request: Request;
}

/**
 * `Props extends object`, not `Record<string, unknown>`: an `interface` has no
 * implicit index signature, so the natural way to type a component's props
 * would not satisfy the narrower constraint and every consumer would have to
 * restate their props as a type alias. The renderer widens once, where the
 * props are handed to it.
 */
export interface FragmentRegistryEntry<Component, Props extends object = object> {
  readonly component: Component;
  /** Props for the component, computed from the input; never from request-controlled code. */
  readonly props: (input: FragmentRenderInput) => Props | Promise<Props>;
}

export type FragmentRegistry<Component> = Readonly<
  Record<string, FragmentRegistryEntry<Component>>
>;

/** Renders a component with props to HTML. Each adapter supplies its own. */
export type FragmentRenderer<Component> = (
  component: Component,
  props: Record<string, unknown>,
  input: FragmentRenderInput,
) => Promise<string>;

export interface FragmentEndpointOptions<Component> {
  /** The only things this endpoint can render. */
  readonly registry: FragmentRegistry<Component>;
  /**
   * The middleware's `authorizePreview` hook — same type, same rules: a
   * context `authorizePreviewRequest()` produced authorizes, anything else
   * refuses, a `PreviewConfigurationError` is loud. It is called with the
   * page request the fragment belongs to (route, search, and this request's
   * headers), so a token stays bound to its route and a session is the
   * visitor's own. One of `authorizePreview` and `authorize` is required.
   */
  readonly authorizePreview?: NonNullable<PreviewAdapterOptions['authorizePreview']>;
  /** A strategy for `authorizePreviewRequest()`, when there is no hook to share. Exclusive with `authorizePreview`. */
  readonly authorize?: PreviewAuthorizationStrategy;
  /** Override the adapter's renderer (tests, another component system). */
  readonly render?: FragmentRenderer<Component>;
  /** Origins besides the page's own that may call the endpoint. Default: none. */
  readonly allowedOrigins?: readonly string[];
  readonly limits?: {
    /** Largest request body. Default 64 KiB. */
    readonly bodyBytes?: number;
    /** Render timeout. Default 5000 ms. */
    readonly timeoutMs?: number;
  };
}

/** What an adapter adds to the consumer's options: its renderer and the name that goes in the response metadata. */
export interface FragmentEndpointBinding<Component> {
  readonly render: FragmentRenderer<Component>;
  readonly rendererName: string;
}

const DEFAULT_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  vary: 'Cookie',
  [FRAGMENT_VERSION_HEADER]: String(FRAGMENT_PROTOCOL_VERSION),
};

/** A refusal carries a status and a generic word, never why. */
function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...NO_STORE_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function sameOrigin(request: Request, allowed: ReadonlySet<string>): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  return origin === new URL(request.url).origin || allowed.has(origin);
}

function scopeAllows(context: AuthorizedPreviewContext, body: FragmentRequestBody): boolean {
  const scope = context.scope;
  if (scope.locale !== undefined && body.locale !== undefined && scope.locale !== body.locale) {
    return false;
  }
  return true;
}

async function readBody(request: Request, limit: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  const text = await request.text();
  if (text.length > limit) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('fragment render timed out'));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

type FragmentAuthorizer = (pageRequest: Request) => Promise<PreviewAuthorization>;

/** One authorizer from the two options: the hook decides as it does in the middleware, a strategy as `authorizePreviewRequest()` does. */
function authorizerFor<Component>(options: FragmentEndpointOptions<Component>): FragmentAuthorizer {
  const { authorize, authorizePreview } = options;
  if (authorizePreview !== undefined && authorize !== undefined) {
    throw new Error(
      'payload-live-preview: createFragmentEndpoint() takes `authorizePreview` or `authorize`, ' +
        'not both — pass the middleware hook as `authorizePreview`, or a strategy as `authorize`.',
    );
  }
  if (authorizePreview !== undefined) {
    return (pageRequest) => runAuthorizeHook(() => authorizePreview(pageRequest));
  }
  if (authorize !== undefined) {
    return (pageRequest) => authorizePreviewRequest(pageRequest, authorize);
  }
  throw new Error(
    'payload-live-preview: createFragmentEndpoint() needs `authorizePreview` (the middleware hook) ' +
      'or `authorize` (a strategy); without one it would render drafts for anyone.',
  );
}

/**
 * The endpoint as a plain `Request` → `Response` function. Adapters wrap it in
 * whatever their framework hands a route handler.
 */
export function createFragmentEndpointHandler<Component>(
  options: FragmentEndpointOptions<Component>,
  binding: FragmentEndpointBinding<Component>,
): (request: Request) => Promise<Response> {
  const authorize = authorizerFor(options);
  const render = options.render ?? binding.render;
  const rendererName = options.render === undefined ? binding.rendererName : 'custom';
  const allowed = new Set(options.allowedOrigins ?? []);
  const bodyLimit = options.limits?.bodyBytes ?? DEFAULT_BODY_BYTES;
  const timeoutMs = options.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const registry = options.registry;

  return async (request) => {
    if (request.method !== 'POST') return refuse(405, 'method');
    if (!sameOrigin(request, allowed)) return refuse(403, 'origin');
    const type = request.headers.get('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/json')) return refuse(415, 'content-type');
    const raw = await readBody(request, bodyLimit);
    if (raw === null) return refuse(413, 'body');
    const body = parseFragmentRequest(raw);
    if (body === null) return refuse(400, 'shape');

    // Authorize as the page would, so a token stays bound to the route it was
    // issued for and a session is the visitor's own.
    const origin = new URL(request.url).origin;
    const pageRequest = new Request(`${origin}${body.route}${body.search}`, {
      headers: request.headers,
    });
    const authorization = await authorize(pageRequest);
    if (!authorization.authorized || !scopeAllows(authorization.context, body)) {
      return refuse(403, 'unauthorized');
    }
    const entry = Object.prototype.hasOwnProperty.call(registry, body.fragment)
      ? registry[body.fragment]
      : undefined;
    if (entry === undefined) return refuse(404, 'fragment');

    const input: FragmentRenderInput = {
      id: body.fragment,
      key: body.key,
      revision: body.revision,
      fields: body.fields,
      locale: body.locale,
      collectionSlug: body.collectionSlug,
      globalSlug: body.globalSlug,
      route: body.route,
      authorization: authorization.context,
      request,
    };
    const started = Date.now();
    let html: string;
    try {
      const props = await withTimeout(Promise.resolve(entry.props(input)), timeoutMs);
      // The one widening: the site types its props as it likes (see
      // FragmentRegistryEntry), the renderer takes a record of them.
      const record = props as Record<string, unknown>;
      html = await withTimeout(render(entry.component, record, input), timeoutMs);
    } catch (error) {
      // The response stays generic; the server log is where the cause belongs,
      // and without it a 500 here is a boundary that silently never renders.
      warnOnce(
        `fragment-render:${body.fragment}`,
        `fragment "${body.fragment}" did not render: ${error instanceof Error ? error.message : String(error)}`,
      );
      return refuse(500, 'render');
    }
    const response: FragmentResponseBody = {
      html,
      boundary: { id: body.fragment, ...(body.key !== undefined ? { key: body.key } : {}) },
      revision: body.revision,
      metadata: {
        renderedAt: new Date().toISOString(),
        renderer: rendererName,
        durationMs: Date.now() - started,
      },
    };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...NO_STORE_HEADERS, 'content-type': 'application/json; charset=utf-8' },
    });
  };
}
