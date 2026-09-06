/**
 * The fragment endpoint as an App Router route handler (docs/hybrid.md). The
 * registry is the only thing it can render, and `defineFragment` ties each
 * component to the props it takes.
 */
import { createFragmentEndpoint, defineFragment } from 'payload-live-preview/nextjs';
import { Hero } from '../../hybrid/Hero';
import { heroProps } from '../../hybrid/document';
import { strategy } from '../../hybrid/preview';

export const POST = createFragmentEndpoint({
  registry: { hero: defineFragment(Hero, ({ fields }) => heroProps(fields)) },
  authorize: strategy,
});
