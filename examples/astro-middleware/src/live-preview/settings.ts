/**
 * Fixture-only preview authorization settings. A real deployment keeps the
 * secret in the environment and shares it with the Payload side, which mints
 * the token in its `livePreview.url` callback; this example has no Payload
 * behind it, so its mock admin mints the token itself.
 */
export const PREVIEW_ORIGIN = 'http://localhost:4183';
export const PREVIEW_AUDIENCE = PREVIEW_ORIGIN;
export const PREVIEW_TOKEN_SECRET =
  process.env['PREVIEW_TOKEN_SECRET'] ?? 'astro-middleware-example-secret-32-bytes-long';
