/**
 * `<LivePreviewNavigation />` — the App Router glue a Next preview needed in
 * its own code before 2.4: it tells the runtime when a client navigation has
 * committed and lends it `router.refresh` for route updates. Mount it once in
 * a layout that stays mounted across the preview routes.
 *
 * This is the one entry that imports `next`: the hooks it needs exist only
 * there, and passing them in as props would leave the glue where it was. `next`
 * is an optional peer, and nothing else in the package imports it.
 */

import { Suspense, createElement, useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { NAVIGATION_COMMIT_EVENT } from '@core/navigation-lifecycle';
import { LivePreviewRouteRefresh } from '@adapters/react/route-refresh';

/** The committed URL, or `null` while the router cannot name it yet. */
function useCommittedKey(): string | null {
  const pathname = usePathname();
  const search = useSearchParams();
  return pathname === null || search === null ? null : `${pathname}?${search.toString()}`;
}

function NavigationBridge(): ReactNode {
  const router = useRouter();
  const key = useCommittedKey();
  const committed = useRef<string | null>(null);

  // The first key is the page the runtime started on, and StrictMode runs this
  // effect twice for it: only a changed key is a navigation. A cancelled
  // transition never changes the key, so it dispatches nothing.
  useEffect(() => {
    if (key === null) return;
    const previous = committed.current;
    committed.current = key;
    if (previous === null || previous === key) return;
    document.dispatchEvent(new Event(NAVIGATION_COMMIT_EVENT));
  }, [key]);

  return createElement(LivePreviewRouteRefresh, { refresh: router.refresh });
}

/**
 * Renders nothing visible. It carries its own Suspense boundary because
 * `useSearchParams()` suspends a prerendered route, and a boundary the caller
 * forgets would turn that route dynamic or fail its build.
 *
 * ```tsx
 * // app/layout.tsx
 * import { LivePreviewNavigation } from 'payload-live-preview/nextjs/client';
 * // inside <body>:
 * <LivePreviewNavigation />
 * ```
 */
export function LivePreviewNavigation(): ReactNode {
  return createElement(Suspense, { fallback: null }, createElement(NavigationBridge));
}
