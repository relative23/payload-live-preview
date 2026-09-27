'use client';

/**
 * Translate App Router commits into the package-owned document event. Route
 * refreshes use Next's own reconciler and settle after its React commit.
 */

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LivePreviewRouteRefresh } from 'payload-live-preview/react';

const NAVIGATION_COMMIT_EVENT = 'payload-live-preview:navigation';

export function PreviewNavigationBridge(): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const key = pathname === null || search === null ? null : `${pathname}?${search.toString()}`;
  const committed = useRef<string | null>(null);

  useEffect(() => {
    if (key === null) return;
    const previous = committed.current;
    committed.current = key;
    if (previous === null || previous === key) return;
    document.dispatchEvent(new Event(NAVIGATION_COMMIT_EVENT));
  }, [key]);

  return <LivePreviewRouteRefresh refresh={router.refresh} />;
}
