/**
 * Middleware entrypoint used by the integration's `mode: 'middleware'`.
 *
 * Astro's `addMiddleware()` takes a module specifier, not a function —
 * so options travel through a virtual module that the integration's
 * Vite plugin provides at build time. Consumers never import this
 * module directly; `livePreview({ mode: 'middleware' })` wires it.
 *
 * @module @adapters/astro/middleware-entry
 */

import { createLivePreviewMiddleware } from './middleware';
import type { LivePreviewAstroOptions } from './types';

// Resolved by the Vite plugin the integration registers; carries the
// JSON-serializable subset of the integration options.
// @ts-expect-error — virtual module, provided at build time
import options from 'virtual:payload-live-preview/options';

export const onRequest = createLivePreviewMiddleware(options as LivePreviewAstroOptions);
