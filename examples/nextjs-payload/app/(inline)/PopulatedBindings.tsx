'use client';
/**
 * Bindings on populated paths, for the real-admin journeys (tests/real-payload):
 * Payload posts a relationship or an upload as an id, the runtime asks its REST API
 * for the document as the editor, and the bindings on `author.email`, `image.filename`
 * and `image` (the file itself) are where the result lands. Home page only. The hook
 * page has no such binding on purpose: without one the DOM runtime asks for a route
 * render, and surface-hook.spec.ts holds that this render keeps the hook's committed DOM.
 */
import { usePathname } from 'next/navigation';

export function PopulatedBindings() {
  if (usePathname() !== '/') return null;
  return (
    <>
      <p>
        Author: <span data-payload-field="author.email" data-testid="author-email" />
      </p>
      <p>
        Image: <span data-payload-field="image.filename" data-testid="image-filename" />
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>: the runtime writes src, React must not own it */}
      <img data-payload-field="image" data-payload-type="upload" data-testid="image" alt="" />
    </>
  );
}
