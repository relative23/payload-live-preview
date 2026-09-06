/**
 * The runtime as a cached asset (docs/nextjs.md). The dynamic segment carries
 * the content hash; the handler answers that one name and 404s the rest.
 */
import { createRuntimeAssetRoute } from 'payload-live-preview/nextjs';
import { assetDelivery } from '../../delivery';

export const { GET } = createRuntimeAssetRoute(assetDelivery);
