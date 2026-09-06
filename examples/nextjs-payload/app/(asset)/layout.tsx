/**
 * Root layout for the asset half of this fixture: `delivery: 'asset'`.
 *
 * The page carries the bootstrap — a few hundred bytes that check for a preview
 * context and, only then, fetch the runtime from the route in
 * `app/payload-live-preview/[file]`. Same options otherwise, so the difference
 * the E2E measures is the delivery and nothing else.
 */
import type { ReactNode } from 'react';
import { livePreviewScriptProps } from 'payload-live-preview/nextjs';
import { styles } from '../styles';
import { assetDelivery } from '../delivery';

const previewScript = livePreviewScriptProps({
  allowedOrigins: ['http://localhost:4174'],
  debug: true,
  debounceMs: 25,
  ...assetDelivery,
});

export const metadata = {
  title: 'Live Preview Demo — asset delivery',
};

export default function AssetRootLayout({ children }: { children: ReactNode }) {
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
