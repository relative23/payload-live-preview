/**
 * The real Payload admin behind HTTPS, for preview sites built for production: strict mode
 * accepts only https admin origins there. `next dev` keeps its loopback port; this front
 * answers on PLP_ADMIN_ORIGIN and copies its certificate to PLP_ADMIN_CERTIFICATE.
 */

import { startTlsFront } from './tls-front.mjs';

const publicUrl = new URL(process.env['PLP_ADMIN_ORIGIN'] ?? 'https://localhost:3443');
if (publicUrl.protocol !== 'https:') throw new Error('PLP_ADMIN_ORIGIN must use HTTPS.');
const front = startTlsFront({
  label: 'Payload admin TLS front',
  publicUrl,
  internalPort: Number(process.env['PLP_ADMIN_INTERNAL_PORT'] ?? '3001'),
  certificateOut: process.env['PLP_ADMIN_CERTIFICATE'],
  // Payload's admin answers `Critical-CH: Sec-CH-Prefers-Color-Scheme`, and Chromium retries such
  // a navigation with the hint. That retry did not keep `ignoreHTTPSErrors`: 1 of 5 page loads came
  // through with the header, 5 of 5 without it (Playwright 1.62.1, Chromium 151, 2026-10-30).
  // `Accept-CH` stays, so the requests after the first one still carry the hint.
  adjust: (_incoming, response) => {
    delete response.headers['critical-ch'];
  },
});
// An upgraded socket outlives close(), so a stop ends the process rather than waiting on it.
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.once(signal, () => {
    front.close();
    process.exit(0);
  });
}
