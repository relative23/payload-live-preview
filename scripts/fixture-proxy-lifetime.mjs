/**
 * Keep each local TLS proxy request tied to its own upstream request. Upload
 * completion is not response completion: a downstream close must still cancel
 * an active upstream without damaging a normally completed keep-alive socket.
 */

/**
 * @param {import('node:http').IncomingMessage} incoming
 * @param {import('node:http').ServerResponse} outgoing
 * @param {import('node:http').ClientRequest} upstream
 * @returns {void}
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Node must run this plain-JS fixture on Node 20 without a TS loader
export function bindProxyLifetime(incoming, outgoing, upstream) {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- native .mjs callback, not a TypeScript entry
  const cleanup = () => {
    incoming.removeListener('close', uploadClosed);
    outgoing.removeListener('close', close);
    outgoing.removeListener('finish', cleanup);
    upstream.removeListener('close', cleanup);
  };
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- native .mjs callback, not a TypeScript entry
  const abort = () => {
    cleanup();
    incoming.unpipe(upstream);
    upstream.destroy();
  };
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- native .mjs callback, not a TypeScript entry
  const close = () => {
    if (outgoing.writableFinished) cleanup();
    else abort();
  };
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- native .mjs callback, not a TypeScript entry
  const uploadClosed = () => {
    if (!incoming.complete) abort();
  };
  incoming.once('close', uploadClosed);
  outgoing.once('close', close);
  outgoing.once('finish', cleanup);
  upstream.once('close', cleanup);
  if (
    (incoming.destroyed && !incoming.complete) ||
    (outgoing.destroyed && !outgoing.writableFinished)
  ) {
    abort();
  }
}
