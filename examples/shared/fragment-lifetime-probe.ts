/**
 * Local transport probe, disabled unless the test runner supplies an ephemeral
 * credential. The custom renderer records phase entry and cooperative abort;
 * it does not claim to test a framework's component rendering or Payload ACLs.
 */
import type { FragmentEndpointOptions } from 'payload-live-preview/nextjs';

type Handler<Context> = (request: Request, context?: Context) => Promise<Response>;
type Factory<Context> = (options: FragmentEndpointOptions) => Handler<Context>;
type Mode = 'success' | 'authorization' | 'props' | 'render' | 'sum';

interface Observation {
  started: number;
  events: string[];
  transportAborted: boolean;
  status?: number;
}

export function createLifetimeProbe<Context = never>(createEndpoint: Factory<Context>) {
  const observations = new Map<string, Observation>();
  return async (request: Request, context?: Context, nativeSocket?: unknown): Promise<Response> => {
    const credential = process.env['PLP_LIFETIME_PROBE_KEY'];
    if (!credential || request.headers.get('x-plp-probe-key') !== credential) {
      return new Response(null, { status: 404 });
    }
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!/^[a-z0-9-]{1,64}$/u.test(id)) return new Response(null, { status: 400 });
    for (const [key, value] of observations) {
      if (Date.now() - value.started > 60_000) observations.delete(key);
    }
    if (request.method === 'GET') {
      return Response.json(observations.get(id) ?? null, {
        headers: { 'cache-control': 'private, no-store' },
      });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (observations.size >= 64 || observations.has(id)) {
      return new Response(null, { status: 429 });
    }
    const rawMode = request.headers.get('x-plp-probe-mode') ?? 'success';
    if (!['success', 'authorization', 'props', 'render', 'sum'].includes(rawMode)) {
      return new Response(null, { status: 400 });
    }
    const mode = rawMode as Mode;
    const observation: Observation = {
      started: Date.now(),
      events: [],
      transportAborted: request.signal.aborted,
    };
    observations.set(id, observation);
    const transportAbort = (): void => {
      observation.transportAborted = true;
    };
    request.signal.addEventListener('abort', transportAbort, { once: true });
    // Observe the actual wire independently of the adapter's effective signal.
    // This listener never aborts work: only a production bridge can turn the
    // socket close into the required early 400 rather than a later 504.
    const socket = nativeSocket as
      | {
          on?: (event: string, callback: () => void) => unknown;
          removeListener?: (event: string, callback: () => void) => unknown;
        }
      | undefined;
    socket?.on?.('close', transportAbort);

    async function phase(name: string, signal: AbortSignal): Promise<void> {
      observation.events.push(`${name}:start`);
      const ms = mode === 'sum' ? 180 : mode === name ? 2_500 : 0;
      if (ms > 0) {
        await new Promise<void>((resolve) => {
          const finish = (): void => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            resolve();
          };
          const abort = (): void => {
            observation.events.push(`${name}:abort`);
            finish();
          };
          const timer = setTimeout(finish, ms);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      }
      observation.events.push(`${name}:end`);
    }

    const endpoint = createEndpoint({
      // Next's self-hosted Request URL retains its internal listening port.
      // Accept only the configured public origin, never a forwarded client value.
      allowedOrigins: process.env['PAYLOAD_ADMIN_ORIGIN']
        ? [new URL(process.env['PAYLOAD_ADMIN_ORIGIN']).origin]
        : [],
      limits: {
        timeoutMs: 3_000,
        totalTimeoutMs: request.headers.get('x-plp-probe-disconnect') === 'true' ? 1_800 : 400,
      },
      authorize: {
        type: 'verifier',
        verify: async (pageRequest) => {
          await phase('authorization', pageRequest.signal ?? request.signal);
          // The same per-run credential must survive page-request reconstruction.
          return pageRequest.headers.get('x-plp-probe-key') === credential
            ? { subject: 'local-lifetime-probe' }
            : null;
        },
      },
      registry: {
        probe: {
          component: () => null,
          props: async ({ signal }) => {
            await phase('props', signal);
            return {};
          },
        },
      },
      render: async (_component, _props, { signal }) => {
        await phase('render', signal);
        return '<p>local lifetime probe</p>';
      },
    });
    try {
      const response = await endpoint(request, context);
      observation.status = response.status;
      observation.events.push('endpoint:end');
      return response;
    } finally {
      request.signal.removeEventListener('abort', transportAbort);
      socket?.removeListener?.('close', transportAbort);
    }
  };
}
