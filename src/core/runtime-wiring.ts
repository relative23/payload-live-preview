/**
 * What the runtime builds around itself before it starts: the screen-reader
 * announcer, and where the `ready` handshake goes.
 *
 * Apart in this module for two reasons. The announcer is the one dependency the
 * lean profile leaves out, and the guard that drops it has to sit in expression
 * position at the seam (`src/types/build-flags.d.ts`); and `lifecycle.ts` is the
 * runtime's own lifecycle, which stays readable only if the wiring around it
 * lives next door rather than inside.
 */

import { A11yAnnouncer } from './a11y';
import { MessageBus } from './message-bus';
import { reportOmittedFeature } from './profile';
import type { RuntimeOptions } from './runtime-options';

/**
 * The announcer and its locale table are ~800 bytes gzip the lean profile does
 * without; a page that asked for announcements is told instead (./profile).
 */
export function createA11y(options: RuntimeOptions): A11yAnnouncer | null {
  return typeof __LEAN_BUILD__ !== 'undefined' && __LEAN_BUILD__
    ? refuseA11y(options)
    : buildA11y(options);
}

function refuseA11y(options: RuntimeOptions): null {
  if (options.enableA11y !== false) reportOmittedFeature('screen-reader announcements');
  return null;
}

function buildA11y(options: RuntimeOptions): A11yAnnouncer | null {
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
