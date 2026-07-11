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

const STYLE_ID = 'payload-live-preview-highlight';
const REDUCED_MOTION_CSS =
  '.lp-highlight{outline:2px solid rgba(0,102,204,0.85);outline-offset:2px;}';
const ANIMATED_CSS =
  '@keyframes lp-highlight{0%{outline:2px solid rgba(0,102,204,0.85);outline-offset:2px}100%{outline:2px solid transparent;outline-offset:2px}}.lp-highlight{animation:lp-highlight 0.6s ease-out;}';

export const highlightPlugin: LivePreviewPlugin = {
  name: 'highlight',
  version: '1.0.0',
  init: (ctx) => {
    if (typeof document === 'undefined') return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = prefersReducedMotion ? REDUCED_MOTION_CSS : ANIMATED_CSS;
      document.head.appendChild(style);
    }
    const duration = prefersReducedMotion ? 1000 : 600;
    ctx.events.on('elementUpdate', (e) => {
      const element = e.element;
      element.classList.add('lp-highlight');
      window.setTimeout(() => {
        element.classList.remove('lp-highlight');
      }, duration);
    });
  },
  destroy: () => {
    if (typeof document === 'undefined') return;
    document.getElementById(STYLE_ID)?.remove();
  },
};
