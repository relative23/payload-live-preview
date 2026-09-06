/**
 * Root layout for the inline half of this fixture — the default delivery,
 * documented in docs/nextjs.md: the runtime is part of the SSR HTML, because
 * Next middleware cannot inject into the body.
 *
 * `app/(asset)` is the second root layout, which serves the same runtime as a
 * cached asset instead. Two route groups rather than two example apps: the
 * delivery is the only difference, and one dev server shows both.
 *
 * No `serverURL` is configured: this fixture has no real Payload
 * backend, updates come straight from the mock admin's postMessage.
 */
import type { ReactNode } from 'react';
import { livePreviewScriptProps } from 'payload-live-preview/nextjs';
import { styles } from '../styles';

const previewScript = livePreviewScriptProps({
  allowedOrigins: ['http://localhost:4174'],
  debug: true,
  debounceMs: 25,
  // Reveal the edited section — exercised by reveal-nextjs.spec.ts.
  revealEditedField: true,
  // Server-rendered boundaries: /hybrid marks one, every other page has none
  // and is patched as before. Exercised by nextjs-fragment.spec.ts.
  fragments: { endpoint: '/payload/fragment' },
});

export const metadata = {
  title: 'Live Preview Demo',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script {...previewScript} />
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
