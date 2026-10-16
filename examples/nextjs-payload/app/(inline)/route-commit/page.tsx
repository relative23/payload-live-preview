/**
 * A dynamic Server Component for the native route-commit contract. Every
 * router refresh receives a new generation, while the runtime must reapply
 * the editor's unsaved title only after that generation has committed.
 */

import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { PreviewRouteRefresh } from './PreviewRouteRefresh';

export const dynamic = 'force-dynamic';

export default function RouteCommitPage(): ReactNode {
  return (
    <article className="grid">
      <PreviewRouteRefresh />
      <p data-testid="server-generation">{randomUUID()}</p>
      <h1 data-payload-field="title">Server title before unsaved edits</h1>
      <p>
        The admin's <code>showExtra</code> field is intentionally unbound so one edit asks the route
        strategy for a native App Router refresh.
      </p>
    </article>
  );
}
