/**
 * Facts Astro owns about every page it injects into. Its client router fires
 * `astro:page-load` after the next document has been committed.
 */

import type { PageFacts } from '@adapters/shared/policy-options';

export const ASTRO_PAGE: PageFacts = {
  softNavigationEvents: ['astro:page-load'],
};
