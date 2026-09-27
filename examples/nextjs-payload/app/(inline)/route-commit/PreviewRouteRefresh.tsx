'use client';

/**
 * Mount the package's commit-aware route seam against Next's App Router. The
 * fixture keeps this in a real client component so production E2E exercises
 * the same transition and effect timing a consumer uses.
 */

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LivePreviewRouteRefresh } from 'payload-live-preview/react';

export function PreviewRouteRefresh(): ReactNode {
  const router = useRouter();
  return <LivePreviewRouteRefresh refresh={router.refresh} />;
}
