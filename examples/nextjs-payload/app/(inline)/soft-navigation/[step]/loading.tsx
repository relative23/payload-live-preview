/**
 * The App Router commits this fallback while the dynamic destination streams.
 * It deliberately has no field binding: the final heading arrives later.
 */

import type { ReactNode } from 'react';

export default function SoftNavigationLoading(): ReactNode {
  return (
    <article className="grid" data-testid="navigation-loading">
      <p>Loading the destination…</p>
    </article>
  );
}
