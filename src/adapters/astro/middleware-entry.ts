/**
 * Entrypoint for `mode: 'middleware'`. `addMiddleware()` takes a module
 * specifier, so the options arrive through a virtual module. Not for consumers.
 */

import { createLivePreviewMiddleware } from './middleware';
import type { LivePreviewAstroOptions } from './types';

// @ts-expect-error — virtual module, provided at build time
import options from 'virtual:payload-live-preview/options';

export const onRequest = createLivePreviewMiddleware(options as LivePreviewAstroOptions);
