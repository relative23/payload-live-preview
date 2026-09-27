/**
 * The fragment endpoint, without a component system (ADR 0011): it renders a
 * registered boundary from unsaved form state for an authorized preview, and
 * nothing else. The browser names a registry id; the server decides what that
 * id renders.
 *
 * Everything here is framework-neutral — method and origin checks, the body
 * limit, the protocol, authorization, the registry lookup, the timeouts and the
 * response shape. Each server adapter binds one renderer and its native route
 * shape; Astro, Next.js, SvelteKit and Nuxt all delegate the decisions here.
 */
import {
  authorizePreviewRequest,
  type PreviewAuthorizationStrategy,
} from '@security/preview-authorization';
import type { PreviewAuthorization } from '@security/preview-verdict';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
import {
  isPayloadScopeCurrent,
  matchesPreviewDocument,
  matchesPreviewDocumentData,
} from '@security/preview-scope';
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
  /** Aborts when the request, its total deadline, or a render phase ends early. */
  readonly signal: AbortSignal;
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
    /** Largest streamed request body in bytes. Default 64 KiB. */
    readonly bodyBytes?: number;
    /** Body-read and per-render-phase timeout. Default 5000 ms. */
    readonly timeoutMs?: number;
    /** One deadline across body, authorization, props and rendering. Default: disabled. */
    readonly totalTimeoutMs?: number;
  };
}

/** What an adapter adds to the consumer's options: its renderer and the name that goes in the response metadata. */
export interface FragmentEndpointBinding<Component> {
  readonly render: FragmentRenderer<Component>;
  readonly rendererName: string;
  /** How the framework transport releases bytes after the endpoint's cap. */
  readonly overLimitBody?: 'cancel' | 'drain';
}

const DEFAULT_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMER_MS = 2_147_483_647;

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

function scopeAllows(
  context: AuthorizedPreviewContext,
  body: FragmentRequestBody,
  page: URL,
): boolean {
  const scope = context.scope;
  if (scope.locale !== undefined && scope.locale !== body.locale) return false;
  if (scope.payload !== undefined) {
    if (
      !isPayloadScopeCurrent(context) ||
      (scope.audience !== undefined && scope.audience !== page.origin) ||
      (scope.path !== undefined && scope.path !== page.pathname)
    ) {
      return false;
    }
    if (body.collectionSlug !== undefined && body.globalSlug !== undefined) return false;
    if (
      !matchesPreviewDocument(scope.payload.document, {
        kind: body.globalSlug === undefined ? 'collection' : 'global',
        slug: body.globalSlug ?? body.collectionSlug,
        id: body.fields['id'],
      })
    ) {
      return false;
    }
    if (!matchesPreviewDocumentData(scope.payload.document, body.fields)) return false;
  }
  return true;
}

type BodyReadResult =
  | { readonly kind: 'parsed'; readonly value: unknown }
  | { readonly kind: 'too-large' | 'timed-out' | 'unreadable' };

function positiveIntegerLimit(
  name: 'bodyBytes' | 'timeoutMs' | 'totalTimeoutMs',
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new RangeError(
      `payload-live-preview: createFragmentEndpoint() limits.${name} must be a positive integer no greater than ${String(maximum)}.`,
    );
  }
  return resolved;
}

type EndpointStopReason = 'request-aborted' | 'total-timeout' | 'phase-timeout';

class EndpointStopped extends Error {
  override readonly name = 'EndpointStopped';
}

interface EndpointRequestScope {
  readonly signal: AbortSignal;
  readonly reason: () => EndpointStopReason | undefined;
  readonly run: <T>(work: () => T | PromiseLike<T>, phaseTimeoutMs?: number) => Promise<T>;
  readonly dispose: () => void;
}

/** One cooperative lifetime for all asynchronous work started by an accepted POST. */
function createEndpointRequestScope(
  requestSignal: AbortSignal,
  totalTimeoutMs: number | undefined,
): EndpointRequestScope {
  const controller = new AbortController();
  const deadline = totalTimeoutMs === undefined ? undefined : performance.now() + totalTimeoutMs;
  let stopped: EndpointStopReason | undefined;
  let resolveStopped: ((reason: EndpointStopReason) => void) | undefined;
  const stoppedPromise = new Promise<EndpointStopReason>((resolve) => {
    resolveStopped = resolve;
  });
  const stop = (reason: EndpointStopReason): void => {
    if (stopped !== undefined) return;
    stopped = reason;
    controller.abort(reason);
    resolveStopped?.(reason);
  };
  const abort = (): void => {
    stop('request-aborted');
  };
  requestSignal.addEventListener('abort', abort, { once: true });
  // AbortSignal does not replay an abort that landed just before registration.
  if (requestSignal.aborted) abort();
  const totalTimer =
    totalTimeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          stop('total-timeout');
        }, totalTimeoutMs);
  const check = (): void => {
    // A long synchronous phase can finish before an overdue timer gets its turn.
    if (deadline !== undefined && performance.now() >= deadline) stop('total-timeout');
    if (stopped !== undefined) throw new EndpointStopped(stopped);
  };

  return {
    signal: controller.signal,
    reason: () => stopped,
    run: async <T>(work: () => T | PromiseLike<T>, phaseTimeoutMs?: number): Promise<T> => {
      check();
      const phaseTimer =
        phaseTimeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              stop('phase-timeout');
            }, phaseTimeoutMs);
      try {
        // The race attaches rejection handlers to both promises, including a
        // late rejection by work that ignores the cooperative signal.
        const value = await Promise.race([
          Promise.resolve().then(() => {
            check();
            return work();
          }),
          stoppedPromise.then((reason) => {
            throw new EndpointStopped(reason);
          }),
        ]);
        // Cooperative work may settle from the abort event itself. The stop
        // remains authoritative, so no following phase starts after it.
        check();
        return value;
      } catch (error) {
        check();
        throw error;
      } finally {
        if (phaseTimer !== undefined) clearTimeout(phaseTimer);
      }
    },
    dispose: () => {
      if (totalTimer !== undefined) clearTimeout(totalTimer);
      requestSignal.removeEventListener('abort', abort);
    },
  };
}

/** A declared length may refuse early, but only consumed bytes may admit. */
function declaredLengthExceeds(request: Request, limit: number): boolean {
  const declared = request.headers.get('content-length');
  if (declared === null || !/^[0-9]+$/u.test(declared)) return false;
  const normalized = declared.replace(/^0+/u, '') || '0';
  const boundary = String(limit);
  return (
    normalized.length > boundary.length ||
    (normalized.length === boundary.length && normalized > boundary)
  );
}

/** Cancel without letting a request-controlled stream delay or reject the response. */
function cancelStream(
  stream: ReadableStream<Uint8Array> | null,
  reason: 'too-large' | 'timed-out' | 'unreadable',
): void {
  if (stream === null || stream.locked) return;
  try {
    void Promise.resolve(stream.cancel(reason)).catch(() => undefined);
  } catch {
    // A broken transport is still one generic body refusal.
  }
}

function signalIsAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Read one Web Request body under an actual-byte cap and one total read deadline. */
async function readBody(
  request: Request,
  signal: AbortSignal,
  limit: number,
  timeoutMs: number,
  overLimitBody: 'cancel' | 'drain',
): Promise<BodyReadResult> {
  const stream = request.body;
  if (signalIsAborted(signal) || request.bodyUsed || stream?.locked === true) {
    cancelStream(stream, 'unreadable');
    return { kind: 'unreadable' };
  }
  if (declaredLengthExceeds(request, limit)) {
    // Do not cancel a body no application reader acquired. SvelteKit maps
    // cancellation to `IncomingMessage.destroy()`, which resets the socket
    // before it can write this endpoint's 413 response. The framework owns
    // disposal of an unread transport after the handler returns.
    return { kind: 'too-large' };
  }
  if (stream === null) return { kind: 'parsed', value: null };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch {
    cancelStream(stream, 'unreadable');
    return { kind: 'unreadable' };
  }

  type StopReason = 'too-large' | 'timed-out' | 'unreadable';
  type ReadRace =
    | { readonly kind: 'read'; readonly result: ReadableStreamReadResult<Uint8Array> }
    | { readonly kind: 'read-error' }
    | { readonly kind: 'stopped'; readonly reason: StopReason };
  let stopped: StopReason | undefined;
  let resolveStopped: ((result: ReadRace) => void) | undefined;
  const stoppedPromise = new Promise<ReadRace>((resolve) => {
    resolveStopped = resolve;
  });
  const stop = (reason: StopReason): void => {
    if (stopped !== undefined) return;
    stopped = reason;
    resolveStopped?.({ kind: 'stopped', reason });
    try {
      void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
    } catch {
      // The first stop reason remains authoritative even if cancellation fails.
    }
  };
  const abort = (): void => {
    stop('unreadable');
  };
  signal.addEventListener('abort', abort, { once: true });
  // An abort can land between the preflight check and listener registration.
  // AbortSignal does not replay that event to a late listener.
  if (signalIsAborted(signal)) abort();
  const timer = setTimeout(() => {
    stop('timed-out');
  }, timeoutMs);
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  let overLimit = false;

  try {
    for (;;) {
      const read = Promise.resolve()
        .then(() => reader.read())
        .then<ReadRace, ReadRace>(
          (result) => ({ kind: 'read', result }),
          () => ({ kind: 'read-error' }),
        );
      const next = await Promise.race([read, stoppedPromise]);
      if (next.kind === 'stopped') return { kind: next.reason };
      if (next.kind === 'read-error') {
        if (overLimit) return { kind: 'too-large' };
        stop('unreadable');
        return { kind: 'unreadable' };
      }
      if (stopped !== undefined) return { kind: stopped };
      if (next.result.done) {
        if (overLimit) return { kind: 'too-large' };
        break;
      }
      if (overLimit) continue;
      if (next.result.value.byteLength > limit - total) {
        // SvelteKit's Node bridge implements Web-stream cancellation as
        // IncomingMessage.destroy(). Drain there under this same deadline so
        // the framework can write the 413; no discarded byte is retained or
        // parsed. Fetch-native transports still cancel immediately.
        if (overLimitBody === 'drain') {
          overLimit = true;
          continue;
        }
        stop('too-large');
        return { kind: 'too-large' };
      }
      total += next.result.value.byteLength;
      try {
        text += decoder.decode(next.result.value, { stream: true });
      } catch {
        stop('unreadable');
        return { kind: 'unreadable' };
      }
    }
    try {
      text += decoder.decode();
      return { kind: 'parsed', value: JSON.parse(text) as unknown };
    } catch {
      // A complete body under the byte cap can still be the wrong shape.
      return { kind: 'parsed', value: null };
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    try {
      reader.releaseLock();
    } catch {
      // Some non-conforming transports keep a read pending after cancel.
    }
  }
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
  const bodyLimit = positiveIntegerLimit(
    'bodyBytes',
    options.limits?.bodyBytes,
    DEFAULT_BODY_BYTES,
    Number.MAX_SAFE_INTEGER,
  );
  const timeoutMs = positiveIntegerLimit(
    'timeoutMs',
    options.limits?.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMER_MS,
  );
  const totalTimeoutMs =
    options.limits?.totalTimeoutMs === undefined
      ? undefined
      : positiveIntegerLimit('totalTimeoutMs', options.limits.totalTimeoutMs, 0, MAX_TIMER_MS);
  const registry = options.registry;

  return async (request) => {
    if (request.method !== 'POST') return refuse(405, 'method');
    if (!sameOrigin(request, allowed)) return refuse(403, 'origin');
    const type = request.headers.get('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/json')) return refuse(415, 'content-type');
    const scope = createEndpointRequestScope(request.signal, totalTimeoutMs);
    const bodyState = { started: false, read: false };
    try {
      const raw = await scope.run(() => {
        bodyState.started = true;
        return readBody(
          request,
          scope.signal,
          bodyLimit,
          timeoutMs,
          binding.overLimitBody ?? 'cancel',
        );
      });
      if (raw.kind !== 'parsed') {
        if (raw.kind === 'too-large') return refuse(413, 'body');
        if (raw.kind === 'timed-out') return refuse(408, 'body');
        return refuse(400, 'body');
      }
      const body = parseFragmentRequest(raw.value);
      if (body === null) return refuse(400, 'shape');
      bodyState.read = true;

      // Authorize as the page would, so a token stays bound to the route it was
      // issued for and a session is the visitor's own.
      const origin = new URL(request.url).origin;
      const pageRequest = new Request(`${origin}${body.route}${body.search}`, {
        headers: request.headers,
        signal: scope.signal,
      });
      const authorization = await scope.run(() => authorize(pageRequest));
      if (
        !authorization.authorized ||
        !scopeAllows(authorization.context, body, new URL(pageRequest.url))
      ) {
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
        signal: scope.signal,
        request,
      };
      const started = Date.now();
      let html: string;
      try {
        const props = await scope.run(() => entry.props(input), timeoutMs);
        if (
          input.authorization.scope.payload !== undefined &&
          !isPayloadScopeCurrent(input.authorization)
        ) {
          return refuse(403, 'unauthorized');
        }
        // The one widening: the site types its props as it likes (see
        // FragmentRegistryEntry), the renderer takes a record of them.
        const record = props as Record<string, unknown>;
        html = await scope.run(() => render(entry.component, record, input), timeoutMs);
        if (
          input.authorization.scope.payload !== undefined &&
          !isPayloadScopeCurrent(input.authorization)
        ) {
          return refuse(403, 'unauthorized');
        }
      } catch (error) {
        if (error instanceof EndpointStopped) throw error;
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
    } catch (error) {
      if (!(error instanceof EndpointStopped)) throw error;
      // A pre-read stop still disposes the unread body, without acquiring it.
      if (!bodyState.started) cancelStream(request.body, 'unreadable');
      if (scope.reason() === 'total-timeout') return refuse(504, 'timeout');
      if (scope.reason() === 'phase-timeout') return refuse(500, 'render');
      return refuse(400, bodyState.read ? 'request' : 'body');
    } finally {
      scope.dispose();
    }
  };
}
