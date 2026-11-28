/**
 * The route prelude: an IIFE leaving `__LIVE_PREVIEW_ROUTE__`, emitted for a
 * page that wants route refreshes without a fragment endpoint.
 *
 * Separate from `inline.ts` because the two cost different amounts. The route
 * strategy is a few hundred bytes; the fragment client is the larger half of
 * ADR 0011 — request, protocol, limits, abort. A page that only refreshes its
 * route must not pay for the half it never calls.
 */
export { createRouteStrategy } from './route';
