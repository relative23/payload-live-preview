'use client';
/**
 * Bindings on populated paths, for the real-admin journeys (tests/real-payload):
 * Payload posts a relationship as an id, the runtime asks its REST API for the
 * document as the editor, and the binding on `author.email` is where the result
 * lands. Home page only. The hook page has no such binding on purpose: without
 * one the DOM runtime asks for a route render, and surface-hook.spec.ts holds
 * that this render keeps the hook's committed DOM.
 */
import { usePathname } from 'next/navigation';

export function PopulatedBindings() {
  if (usePathname() !== '/') return null;
  return (
    <p>
      Author: <span data-payload-field="author.email" data-testid="author-email" />
    </p>
  );
}
