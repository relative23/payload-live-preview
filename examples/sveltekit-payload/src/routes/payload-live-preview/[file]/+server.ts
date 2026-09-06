/**
 * The runtime as a cached asset (docs/sveltekit.md). The dynamic segment
 * carries the content hash; the handler answers that one name and 404s the
 * rest, which is what lets it promise a year of `immutable`.
 */
import { createRuntimeAssetRoute } from 'payload-live-preview/sveltekit';
import { assetOptions } from '../../../hooks.server';

export const { GET } = createRuntimeAssetRoute(assetOptions);
