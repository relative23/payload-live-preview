/**
 * What the runtime says about a message the bus refused. Most refusals are
 * silent by design; three reasons are worth a line a developer sees without
 * `debug`, because each of them stops a preview that looks set up correctly.
 */

import type { InvalidReason } from '../protocol/message-bus';
import type { RuntimeDeps, RuntimeState } from './runtime-state';

/** A rejected token is an `error` event; an unknown shape and a foreign source warn once each. */
export function reportInvalidMessage(
  deps: RuntimeDeps,
  state: RuntimeState,
  reason: InvalidReason,
  origin: string,
): void {
  if (reason === 'token') {
    const error = new Error(`Preview token rejected (origin: ${origin})`);
    void deps.emitter.emit('error', { error, context: 'token', code: 'LP0502' });
  }
  // An unknown shape from a trusted origin is protocol drift, not an attack.
  // Report it here once: without `debug`, no other boundary makes it visible.
  if ((reason === 'shape' || reason === 'type') && !state.warnedProtocolShape) {
    state.warnedProtocolShape = true;
    deps.warn(
      `[live-preview] LP0503: ${origin} posted a message this runtime does not recognise ` +
        `(${reason === 'type' ? 'unknown message type' : 'unexpected shape'}); it was ` +
        'ignored. A newer Payload or a custom sender: check that the versions match.',
    );
  }
  // This refusal default changed in 2.0. An admin posting from outside the
  // framing or opening window silently stops updates, so report it once.
  if (reason === 'source' && !state.warnedForeignSource) {
    state.warnedForeignSource = true;
    deps.warn(
      `[live-preview] LP0501: a message from ${origin} was ignored because it did not come ` +
        'from the window that framed or opened this page. `eventSourcePolicy` is ' +
        "'parent-or-opener' by default since 2.0, where 1.x accepted any window on a " +
        "trusted origin. Set `eventSourcePolicy: 'any'` if the admin posts from elsewhere.",
    );
  }
  deps.log('LP0501 message rejected:', reason, origin);
}
