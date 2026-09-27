/**
 * Resolve the fixture's trusted admin origin once for Next config and server
 * modules. Development uses the local E2E origin; production uses an inert
 * HTTPS default unless the deployment supplies its actual admin origin.
 */

const DEVELOPMENT_ADMIN_ORIGIN = 'http://localhost:4174';
const PRODUCTION_ADMIN_ORIGIN = 'https://admin.example.test';

export function resolvePreviewAdminOrigin(environment = process.env) {
  const configured = environment.PAYLOAD_ADMIN_ORIGIN?.trim();
  const url = new URL(
    configured && configured.length > 0
      ? configured
      : environment.NODE_ENV === 'development'
        ? DEVELOPMENT_ADMIN_ORIGIN
        : PRODUCTION_ADMIN_ORIGIN,
  );
  if (environment.NODE_ENV !== 'development' && url.protocol !== 'https:') {
    throw new Error('PAYLOAD_ADMIN_ORIGIN must use HTTPS in production.');
  }
  return url.origin;
}

export const PREVIEW_ADMIN_ORIGIN = resolvePreviewAdminOrigin();
