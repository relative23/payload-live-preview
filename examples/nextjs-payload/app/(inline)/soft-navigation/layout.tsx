/**
 * The navigation bridge lives in a persistent segment, so its previous route
 * key survives while the dynamic child is replaced by the App Router.
 */

import { Suspense, type ReactNode } from 'react';
import { PreviewNavigationBridge } from './PreviewNavigationBridge';

export default function SoftNavigationLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <Suspense fallback={null}>
        <PreviewNavigationBridge />
      </Suspense>
      {children}
    </>
  );
}
