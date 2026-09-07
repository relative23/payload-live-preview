/**
 * `<LivePreviewRouteRefresh />` — lends the runtime the host router's own
 * refresh, so a route update is a re-render the framework performs rather than
 * fresh HTML this package morphs over the reconciler's nodes (see
 * `src/core/route-refresh.ts` for why that is worth avoiding).
 *
 * It takes the refresh as a prop instead of reaching for `next/navigation`,
 * because `next` is not a dependency of this package and must not become one
 * for a component this small. In Next's App Router that is one client
 * component:
 *
 * ```tsx
 * 'use client';
 * import { useRouter } from 'next/navigation';
 * import { LivePreviewRouteRefresh } from 'payload-live-preview/react';
 *
 * export function LivePreviewRefresh() {
 *   return <LivePreviewRouteRefresh refresh={useRouter().refresh} />;
 * }
 * ```
 *
 * The same component serves any router with a refresh of that shape.
 */

import { useEffect, useRef, useTransition } from 'react';
import { registerRouteRefresh } from '@core/route-refresh';

export interface LivePreviewRouteRefreshProps {
  /** The host router's refresh — `useRouter().refresh` in Next's App Router. */
  readonly refresh: () => void;
}

/** Resolve everyone waiting on the transition that has just finished. */
function settle(waiting: { current: (() => void)[] }): void {
  const settled = waiting.current;
  waiting.current = [];
  for (const resolve of settled) resolve();
}

/**
 * Renders nothing. Mount it once inside the preview tree; a second one takes
 * the registration from the first, and unmounting gives it back.
 */
export function LivePreviewRouteRefresh({ refresh }: LivePreviewRouteRefreshProps): null {
  const [pending, startTransition] = useTransition();
  const waiting = useRef<(() => void)[]>([]);

  // The runtime re-applies the revision on top of the fresh markup, so the
  // refresh it is given may not resolve before that markup is committed. The
  // transition is what makes that observable: it is pending until React has
  // rendered the new server output, and this effect runs on the commit after.
  useEffect(() => {
    if (!pending) settle(waiting);
  });

  useEffect(() => {
    const undo = registerRouteRefresh(
      () =>
        new Promise<void>((resolve) => {
          waiting.current.push(resolve);
          startTransition(() => {
            refresh();
          });
        }),
    );
    // A tree that unmounts mid-refresh will never commit one, so the waiting
    // runtime is released here rather than left holding a promise for good.
    return () => {
      undo();
      settle(waiting);
    };
  }, [refresh, startTransition]);

  return null;
}
