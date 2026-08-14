/**
 * `highlight` plugin — flashes an outline on updated elements so the
 * editor can see what changed.
 *
 * Respects `prefers-reduced-motion`. Adds at most one style tag per
 * document.
 *
 * @module @plugins/built-in/highlight
 */

import type { LivePreviewPlugin } from '../types';
import type { PluginDisposer } from '../types';

const STYLE_ID = 'payload-live-preview-highlight';
const REDUCED_MOTION_CSS =
  '.lp-highlight{outline:2px solid rgba(0,102,204,0.85);outline-offset:2px;}';
const ANIMATED_CSS =
  '@keyframes lp-highlight{0%{outline:2px solid rgba(0,102,204,0.85);outline-offset:2px}100%{outline:2px solid transparent;outline-offset:2px}}.lp-highlight{animation:lp-highlight 0.6s ease-out;}';

interface StyleLease {
  readonly element: HTMLStyleElement;
  readonly pluginOwned: boolean;
  owners: number;
}

// DOM-keyed shared leases prevent one client from removing resources still in
// use by another client. WeakMaps do not retain discarded documents/elements.
const styleLeases = new WeakMap<Document, StyleLease>();
interface HighlightLease {
  owners: number;
  readonly pluginAdded: boolean;
}

const highlightLeases = new WeakMap<Element, HighlightLease>();

export const highlightPlugin: LivePreviewPlugin = {
  name: 'highlight',
  version: '1.0.0',
  init: (ctx) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const releaseStyle = acquireStyle(document, prefersReducedMotion);
    const duration = prefersReducedMotion ? 1000 : 600;
    const activeTimers = new WeakMap<Element, PluginDisposer>();
    // Only currently armed timers are strongly retained. Each completion
    // removes itself; one registration-owned cleanup drains the bounded set on
    // teardown without requiring a new public disposer-return contract.
    const timerCleanups = new Set<PluginDisposer>();
    ctx.registerCleanup?.(() => {
      for (const cleanup of [...timerCleanups]) cleanup();
      releaseStyle();
    });
    ctx.events.on('elementUpdate', (e) => {
      const element = e.element;
      activeTimers.get(element)?.();
      const releaseHighlight = acquireHighlight(element);
      let disposed = false;
      const disposeTimer: PluginDisposer = () => {
        if (disposed) return;
        disposed = true;
        window.clearTimeout(handle);
        if (activeTimers.get(element) === disposeTimer) activeTimers.delete(element);
        timerCleanups.delete(disposeTimer);
        releaseHighlight();
      };
      const handle = window.setTimeout(disposeTimer, duration);
      timerCleanups.add(disposeTimer);
      activeTimers.set(element, disposeTimer);
    });
  },
};

function acquireStyle(document: Document, prefersReducedMotion: boolean): PluginDisposer {
  let lease = styleLeases.get(document);
  // Tests, HMR, or a host DOM swap may remove an owned node without running
  // plugin teardown. Never reuse a disconnected lease.
  if (lease !== undefined && !lease.element.isConnected) {
    styleLeases.delete(document);
    lease = undefined;
  }
  if (lease === undefined) {
    const existing = document.getElementById(STYLE_ID);
    const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style');
    const pluginOwned = existing === null;
    if (pluginOwned) {
      style.id = STYLE_ID;
      style.textContent = prefersReducedMotion ? REDUCED_MOTION_CSS : ANIMATED_CSS;
      document.head.appendChild(style);
    }
    lease = { element: style, pluginOwned, owners: 0 };
    styleLeases.set(document, lease);
  }
  const acquiredLease = lease;
  acquiredLease.owners += 1;

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    acquiredLease.owners -= 1;
    if (acquiredLease.owners > 0) return;
    if (styleLeases.get(document) === acquiredLease) styleLeases.delete(document);
    if (acquiredLease.pluginOwned) acquiredLease.element.remove();
  };
}

function acquireHighlight(element: Element): PluginDisposer {
  let lease = highlightLeases.get(element);
  if (lease === undefined) {
    lease = { owners: 0, pluginAdded: !element.classList.contains('lp-highlight') };
    highlightLeases.set(element, lease);
  }
  const acquiredLease = lease;
  acquiredLease.owners += 1;
  element.classList.add('lp-highlight');
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    acquiredLease.owners -= 1;
    if (acquiredLease.owners > 0) return;
    highlightLeases.delete(element);
    if (acquiredLease.pluginAdded) element.classList.remove('lp-highlight');
  };
}
