/**
 * Fixture-only preview authorization settings.
 *
 * A real deployment keeps the secret in the environment and shares it with
 * the Payload side, which mints the token inside its `livePreview.url`
 * callback (see the README, "Authorized preview URLs"). This example has no
 * Payload behind it, so the mock admin fetches a token from
 * `/preview-token` instead; the strategy the hook verifies with is the real
 * one, and so is everything the tests assert.
 */
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

const DEVELOPMENT_ADMIN_ORIGIN = 'http://localhost:4175';
const PRODUCTION_ADMIN_ORIGIN = 'https://admin.example.test';

function resolveAdminOrigin(): string {
  const configured = env.PAYLOAD_ADMIN_ORIGIN?.trim();
  const url = new URL(
    configured && configured.length > 0
      ? configured
      : dev
        ? DEVELOPMENT_ADMIN_ORIGIN
        : PRODUCTION_ADMIN_ORIGIN,
  );
  if (!dev && url.protocol !== 'https:') {
    throw new Error('PAYLOAD_ADMIN_ORIGIN must use HTTPS in production.');
  }
  return url.origin;
}

export const PREVIEW_ADMIN_ORIGIN = resolveAdminOrigin();
export const PREVIEW_AUDIENCE = PREVIEW_ADMIN_ORIGIN;
const configuredSecret = env.PREVIEW_TOKEN_SECRET?.trim();
export const PREVIEW_TOKEN_SECRET =
  configuredSecret && configuredSecret.length > 0
    ? configuredSecret
    : 'sveltekit-example-secret-at-least-32-bytes-long';
