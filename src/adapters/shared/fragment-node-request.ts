/**
 * Node HTTP/1 framework bridges can lose post-upload disconnects, or destroy
 * the socket when a Web body is cancelled. Borrow their body and socket for
 * one endpoint call: stop reading on refusal, then let HTTP flush and close.
 */

interface NativeRequest {
  readonly httpVersionMajor: 1;
  readonly socket: {
    readonly destroyed: boolean;
    on(event: 'close', listener: () => void): unknown;
    removeListener(event: 'close', listener: () => void): unknown;
  };
  pause(): unknown;
}

function isNativeRequest(value: unknown): value is NativeRequest {
  if (typeof value !== 'object' || value === null) return false;
  if (!('httpVersionMajor' in value) || value.httpVersionMajor !== 1) return false;
  if (!('pause' in value) || typeof value.pause !== 'function') return false;
  if (!('socket' in value) || typeof value.socket !== 'object' || value.socket === null) {
    return false;
  }
  const { socket } = value;
  return (
    'destroyed' in socket &&
    typeof socket.destroyed === 'boolean' &&
    'on' in socket &&
    typeof socket.on === 'function' &&
    'removeListener' in socket &&
    typeof socket.removeListener === 'function'
  );
}

/** @internal The two server bindings supply their host's native request, never a wire value. */
export async function withNodeFragmentRequest(
  request: Request,
  native: unknown,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!isNativeRequest(native) || request.bodyUsed || request.body?.locked === true) {
    return handler(request);
  }
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  native.socket.on('close', abort);
  request.signal.addEventListener('abort', abort, { once: true });
  if (native.socket.destroyed || request.signal.aborted) abort();

  const source = request.body;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = source === null;
  let stopped = false;
  // A pending pull resumes after cancel/finally has changed this flag.
  const isStopped = (): boolean => stopped;
  const release = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      if (!finished) native.pause();
    } finally {
      // Releasing rejects any pending read. Its pull catches that rejection;
      // forwarding cancel would instead destroy SvelteKit's response socket.
      reader?.releaseLock();
      reader = undefined;
    }
  };
  try {
    const body =
      source === null
        ? null
        : new ReadableStream<Uint8Array>(
            {
              async pull(target) {
                if (isStopped()) return;
                try {
                  reader ??= source.getReader();
                  const next = await reader.read();
                  if (isStopped()) return;
                  if (next.done) {
                    finished = true;
                    target.close();
                  } else {
                    target.enqueue(next.value);
                  }
                } catch (error) {
                  if (!isStopped()) target.error(error);
                }
              },
              cancel: release,
            },
            { highWaterMark: 0 },
          );
    const effective = new Request(request, {
      body,
      signal: controller.signal,
      // Node requires this for streaming requests; other hosts never enter here.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const response = await handler(effective);
    if (finished) return response;
    const headers = new Headers(response.headers);
    headers.set('connection', 'close');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } finally {
    try {
      release();
    } finally {
      native.socket.removeListener('close', abort);
      request.signal.removeEventListener('abort', abort);
    }
  }
}
