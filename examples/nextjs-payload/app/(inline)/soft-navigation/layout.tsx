/**
 * The navigation component lives in a persistent segment, so its previous
 * route key survives while the dynamic child is replaced by the App Router.
 */

import type { ReactNode } from 'react';
import { LivePreviewNavigation } from 'payload-live-preview/nextjs/client';

export default function SoftNavigationLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <LivePreviewNavigation />
      {children}
    </>
  );
}
