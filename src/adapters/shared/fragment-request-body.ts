/**
 * Read one Web request body for the fragment endpoint, under a cap that counts
 * the bytes consumed and one deadline for the whole read. A stream the request
 * controls can neither delay nor reject the refusal; how the bytes past the cap
 * are released depends on the framework's transport (ADR 0027).
 */

export type BodyReadResult =
  | { readonly kind: 'parsed'; readonly value: unknown }
  | { readonly kind: 'too-large' | 'timed-out' | 'unreadable' };

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
export function cancelStream(
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
export async function readBody(
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
