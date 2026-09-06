/**
 * The runtime as a cached asset (docs/nuxt.md). Nitro hands a route handler an
 * H3 event, so the web request is taken from it once here and this package
 * needs no `h3` dependency of its own — the same shape the fragment route uses.
 */
import { createRuntimeAssetRoute } from 'payload-live-preview/nuxt';
import { livePreviewOptions } from '../../../lib/live-preview';

const asset = createRuntimeAssetRoute(livePreviewOptions);

export default defineEventHandler((event) => asset(toWebRequest(event)));
