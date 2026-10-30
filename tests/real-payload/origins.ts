/**
 * Where the admin and the preview answer. `playwright.real-payload.config.ts` sets both: plain
 * HTTP on localhost for the development servers, HTTPS fronts for a preview built for production.
 */
export const ADMIN_ORIGIN = process.env['PLP_REAL_PAYLOAD_ADMIN_ORIGIN'] ?? 'http://localhost:3001';
export const PREVIEW_ORIGIN =
  process.env['PLP_REAL_PAYLOAD_PREVIEW_ORIGIN'] ??
  `http://localhost:${process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4474'}`;
