/**
 * A dynamic Server Component for the native route-commit contract. Every
 * router refresh receives a new generation, while the runtime must reapply
 * the editor's unsaved title only after that generation has committed.
 *
 * The body is rich text React renders as elements. The runtime replaces those
 * children as the editor types, so a refresh that brings a saved value of
 * another shape would have React remove nodes that are no longer there; the
 * `key`, a fingerprint of the saved value, makes React replace the element
 * instead (docs/nextjs.md, "Rich text React renders itself"). The spec moves
 * the saved value on with a cookie, as a save would.
 */

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { PreviewRouteRefresh } from './PreviewRouteRefresh';

export const dynamic = 'force-dynamic';

const SAVED_BODIES: Readonly<Record<string, readonly string[]>> = {
  first: ['Saved paragraph one', 'Saved paragraph two', 'Saved paragraph three'],
  second: ['Saved after the edit'],
};

/** FNV-1a over the serialized value: it changes exactly when the saved value does. */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? '';
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export default async function RouteCommitPage(): Promise<ReactNode> {
  const stored = (await cookies()).get('route-commit-saved-body')?.value;
  const body =
    (stored === undefined ? undefined : SAVED_BODIES[stored]) ?? SAVED_BODIES['first'] ?? [];
  return (
    <article className="grid">
      <PreviewRouteRefresh />
      <p data-testid="server-generation">{randomUUID()}</p>
      <h1 data-payload-field="title">Server title before unsaved edits</h1>
      <div
        key={fingerprint(body)}
        data-payload-field="body"
        data-payload-richtext=""
        data-testid="rich-text"
      >
        {body.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <p>
        The admin's <code>showExtra</code> field is intentionally unbound so one edit asks the route
        strategy for a native App Router refresh.
      </p>
    </article>
  );
}
