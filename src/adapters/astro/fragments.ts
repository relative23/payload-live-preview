/**
 * The Astro fragment endpoint (ADR 0011): renders a registered component
 * boundary from unsaved form state for an authorized preview, and nothing
 * else. The browser names a registry id; the server decides what it renders.
 */
import {
  authorizePreviewRequest,
  type PreviewAuthorizationStrategy,
} from '@security/preview-authorization';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
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

/** An Astro component as `import Hero from './Hero.astro'` yields it. */
export type AstroComponentLike = object;

export interface FragmentRegistryEntry<
  Props extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly component: AstroComponentLike;
  /** Props for the component, computed from the input; never from request-controlled code. */
  readonly props: (input: FragmentRenderInput) => Props | Promise<Props>;
}

export type FragmentRegistry = Readonly<Record<string, FragmentRegistryEntry>>;

/** Renders a component with props to HTML; the default uses Astro's container API. */
export type FragmentRenderer = (
  component: AstroComponentLike,
  props: Record<string, unknown>,
  input: FragmentRenderInput,
) => Promise<string>;

export interface FragmentEndpointOptions {
  /** The only things this endpoint can render. */
  readonly registry: FragmentRegistry;
  /** How a preview request is authorized; the same strategies as `authorizePreviewRequest()`. */
  readonly authorize: PreviewAuthorizationStrategy;
  /** Override the renderer (tests, other component systems). Default: Astro container. */
  readonly render?: FragmentRenderer;
  /** Origins besides the page's own that may call the endpoint. Default: none. */
  readonly allowedOrigins?: readonly string[];
  readonly limits?: {
    /** Largest request body. Default 64 KiB. */
    readonly bodyBytes?: number;
    /** Render timeout. Default 5000 ms. */
    readonly timeoutMs?: number;
  };
}

const DEFAULT_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const RENDERER_NAME = 'astro-container';

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

interface ContainerLike {
  renderToString: (
    component: AstroComponentLike,
    options: { props: Record<string, unknown> },
  ) => Promise<string>;
}

let containerPromise: Promise<ContainerLike> | undefined;

/** The default renderer: Astro's container, created once per process. */
async function renderWithContainer(
  component: AstroComponentLike,
  props: Record<string, unknown>,
): Promise<string> {
  containerPromise ??= (async () => {
    const specifier = 'astro/container';
    const astro = (await import(/* @vite-ignore */ specifier)) as {
      experimental_AstroContainer: { create: () => Promise<unknown> };
    };
    return (await astro.experimental_AstroContainer.create()) as ContainerLike;
  })();
  const container = await containerPromise;
  return container.renderToString(component, { props });
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

/** Build the endpoint; export it as the `POST` of a non-prerendered Astro API route. */
export function createFragmentEndpoint(
  options: FragmentEndpointOptions,
): (context: { readonly request: Request }) => Promise<Response> {
  const render = options.render ?? renderWithContainer;
  const allowed = new Set(options.allowedOrigins ?? []);
  const bodyLimit = options.limits?.bodyBytes ?? DEFAULT_BODY_BYTES;
  const timeoutMs = options.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const registry = options.registry;

  return async ({ request }) => {
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
    const authorization = await authorizePreviewRequest(pageRequest, options.authorize);
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
      html = await withTimeout(render(entry.component, props, input), timeoutMs);
    } catch {
      return refuse(500, 'render');
    }
    const response: FragmentResponseBody = {
      html,
      boundary: { id: body.fragment, ...(body.key !== undefined ? { key: body.key } : {}) },
      revision: body.revision,
      metadata: {
        renderedAt: new Date().toISOString(),
        renderer: options.render === undefined ? RENDERER_NAME : 'custom',
        durationMs: Date.now() - started,
      },
    };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...NO_STORE_HEADERS, 'content-type': 'application/json; charset=utf-8' },
    });
  };
}
