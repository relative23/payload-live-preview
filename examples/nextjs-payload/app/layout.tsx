/**
 * Root layout — embeds the live preview inline script exactly as
 * documented in the README's "Next.js (App Router)" section: the
 * script is generated on the server with `generateInlineScript()` and
 * placed in `<head>` via `dangerouslySetInnerHTML`, so it is part of
 * the SSR HTML (Next middleware cannot inject into the body).
 *
 * No `serverURL` is configured: this fixture has no real Payload
 * backend, updates come straight from the mock admin's postMessage.
 */
import type { ReactNode } from 'react';
import { generateInlineScript } from 'payload-live-preview';

const previewScript = generateInlineScript({
  allowedOrigins: ['http://localhost:4174'],
  debug: true,
  debounceMs: 25,
});

const styles = `
  :root {
    color-scheme: light dark;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  body {
    margin: 0;
    padding: 2rem;
    max-width: 720px;
    margin-inline: auto;
  }
  [data-payload-field] {
    transition: background-color 0.3s ease;
  }
  img {
    max-width: 100%;
    border-radius: 8px;
  }
  ul.tags {
    list-style: none;
    padding: 0;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  ul.tags li {
    background: rgba(0, 102, 204, 0.1);
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.85rem;
  }
  time {
    color: rgba(0, 0, 0, 0.6);
    font-size: 0.9rem;
  }
  .grid {
    display: grid;
    gap: 1rem;
  }
`;

export const metadata = {
  title: 'Live Preview Demo',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: previewScript }} />
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
