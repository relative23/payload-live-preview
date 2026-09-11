/**
 * Root layout for the inline half of this fixture — the delivery documented in
 * docs/nextjs.md: the runtime is part of the SSR HTML, because Next middleware
 * cannot inject into the body.
 *
 * `<LivePreviewScript />` rather than `livePreviewScriptProps()`, which is what
 * this layout used until LP-8 was closed: the helper is synchronous, so it
 * builds the script for whoever is asking, and a root layout is asked by every
 * visitor. The component is an async server component, so it can wait for
 * `authorizePreview` and render nothing at all for a request that is not a
 * preview. `tests/e2e/specs/public-response.spec.ts` holds both halves: zero
 * bytes for an anonymous request to `/`, the whole runtime for one carrying the
 * cookie `/preview-session` writes.
 *
 * `inject: 'always'` is not a loosening. Next hands a server component the
 * request headers and cookies but not its URL, so the default `previewSignals:
 * ['query']` cannot see `?preview=true` here and would refuse every request.
 * With `'always'` the intent check steps aside and `authorizePreview` is the
 * single gate — the stricter reading, and the one LP-8 asks for.
 *
 * `app/(asset)` is the second root layout, which serves the same runtime as a
 * cached asset instead. Two route groups rather than two example apps: the
 * delivery is the only difference, and one dev server shows both.
 *
 * No `serverURL` is configured: this fixture has no real Payload backend,
 * updates come straight from the mock admin's postMessage.
 */
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { LivePreviewScript } from 'payload-live-preview/nextjs';
import { styles } from '../styles';
import { SITE, authorizePreview } from '../preview';

const previewOptions = {
  allowedOrigins: ['http://localhost:4174'],
  debug: true,
  debounceMs: 25,
  // Reveal the edited section — exercised by reveal.spec.ts.
  revealEditedField: true,
  // Server-rendered boundaries: /hybrid marks one, every other page has none
  // and is patched as before. Exercised by nextjs-fragment.spec.ts.
  fragments: { endpoint: '/payload/fragment' },
  inject: 'always',
  authorizePreview,
} as const;

export const metadata = {
  title: 'Live Preview Demo',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* The URL is the caller's to supply and a layout has none, so the site
            origin stands in for it; with `inject: 'always'` nothing reads the
            path, and the cookie the hook verifies is not bound to one. */}
        <LivePreviewScript
          {...previewOptions}
          request={new Request(SITE, { headers: await headers() })}
        />
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
