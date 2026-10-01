/**
 * The one thing the layout and the asset route have to agree on. Both import
 * it, so the bootstrap can never ask for a path the route does not answer.
 */
import { BASE_PATH } from '../base-path.mjs';

export const assetDelivery = {
  delivery: 'asset',
  ...(BASE_PATH === '' ? {} : { assetPath: `${BASE_PATH}/payload-live-preview` }),
} as const;
