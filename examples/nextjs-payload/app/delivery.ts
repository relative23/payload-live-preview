/**
 * The one thing the layout and the asset route have to agree on. Both import
 * it, so the bootstrap can never ask for a path the route does not answer.
 */
export const assetDelivery = { delivery: 'asset' } as const;
