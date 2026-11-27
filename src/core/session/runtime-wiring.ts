/**
 * What the runtime builds around itself before it starts: the screen-reader
 * announcer, and where the `ready` handshake goes.
 *
 * Apart in this module because `lifecycle.ts` is the runtime's own lifecycle,
 * which stays readable only if the wiring around it lives next door rather than
 * inside.
 */

import { A11yAnnouncer } from '../bindings/a11y';
import { MessageBus } from '../protocol/message-bus';
import type { RuntimeOptions } from './runtime-options';

export function createA11y(options: RuntimeOptions): A11yAnnouncer | null {
  if (options.enableA11y === false) return null;
  const root = options.root;
  const targetDocument =
    root === undefined ? undefined : isDocumentRoot(root) ? root : root.ownerDocument;
  return new A11yAnnouncer(options.a11yLocale, targetDocument);
}

/** Node types are stable across realms; global constructors are not. */
function isDocumentRoot(root: Document | Element): root is Document {
  return root.nodeType === 9;
}

/** The framing or opening window, which is the only one that asked for a preview. */
export function defaultSendReady(origins: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const targets: Window[] = [];
  if (window.parent !== window) targets.push(window.parent);
  if (window.opener instanceof Window) targets.push(window.opener);
  MessageBus.sendReady(targets, origins);
}
