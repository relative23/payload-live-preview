/**
 * `highlight` plugin: flashes an outline on updated elements. Respects
 * `prefers-reduced-motion`; the stylesheet is shared per document across
 * clients through a lease (ADR 0002).
 */

import type { LivePreviewPlugin, PluginDisposer } from '../types';

const STYLE_ID = 'payload-live-preview-highlight';
const REDUCED_MOTION_CSS =
  '.lp-highlight{outline:2px solid rgba(0,102,204,0.85);outline-offset:2px;}';
const ANIMATED_CSS =
  '@keyframes lp-highlight{0%{outline:2px solid rgba(0,102,204,0.85);outline-offset:2px}100%{outline:2px solid transparent;outline-offset:2px}}.lp-highlight{animation:lp-highlight 0.6s ease-out;}';

interface StyleLease {
  readonly pluginOwned: boolean;
  readonly connected: () => boolean;
  readonly remove: () => void;
  owners: number;
}

interface HighlightLease {
  owners: number;
  readonly pluginAdded: boolean;
}

const styleLeases = new WeakMap<Document, StyleLease>();
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
    // Only armed timers are retained; one registration-owned cleanup drains them.
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
  // HMR or a host DOM swap may drop the sheet without plugin teardown.
  if (lease !== undefined && !lease.connected()) {
    styleLeases.delete(document);
    lease = undefined;
  }
  if (lease === undefined) {
    lease = installStyle(document, prefersReducedMotion ? REDUCED_MOTION_CSS : ANIMATED_CSS);
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
    if (acquiredLease.pluginOwned) acquiredLease.remove();
  };
}

function installStyle(document: Document, css: string): StyleLease {
  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    return {
      pluginOwned: false,
      connected: () => existing.isConnected,
      remove: () => undefined,
      owners: 0,
    };
  }
  const sheet = adoptSheet(document, css);
  if (sheet !== undefined) {
    return {
      pluginOwned: true,
      connected: () => document.adoptedStyleSheets.includes(sheet),
      remove: () => {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      },
      owners: 0,
    };
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
  return {
    pluginOwned: true,
    connected: () => style.isConnected,
    remove: () => {
      style.remove();
    },
    owners: 0,
  };
}

// A constructed sheet needs no nonce under `style-src`; `<style>` is only the fallback.
function adoptSheet(document: Document, css: string): CSSStyleSheet | undefined {
  try {
    if (!Array.isArray(document.adoptedStyleSheets) || typeof CSSStyleSheet !== 'function') {
      return undefined;
    }
    const sheet = new CSSStyleSheet();
    if (typeof sheet.replaceSync !== 'function') return undefined;
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return sheet;
  } catch {
    return undefined;
  }
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
