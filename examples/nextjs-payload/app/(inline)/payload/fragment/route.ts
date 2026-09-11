/**
 * The fragment endpoint as an App Router route handler (docs/hybrid.md). The
 * registry is the only thing it can render, and `defineFragment` ties each
 * component to the props it takes.
 *
 * `authorize` is the strategy rather than the layout's hook: the endpoint
 * rebuilds the page request from the boundary's route and search, so the token
 * it verifies is the route-bound one in the query — the cookie gets a page its
 * runtime, this gets a boundary its render.
 */
import { createFragmentEndpoint, defineFragment } from 'payload-live-preview/nextjs';
import { Hero } from '../../hybrid/Hero';
import { heroProps } from '../../hybrid/document';
import { strategy } from '../../../preview';

export const POST = createFragmentEndpoint({
  registry: { hero: defineFragment(Hero, ({ fields }) => heroProps(fields)) },
  authorize: strategy,
});
