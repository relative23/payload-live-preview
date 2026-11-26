/**
 * Fixture-only preview settings. A real deployment keeps the secret in the
 * environment and lets Payload mint the token inside its `livePreview.url`
 * callback; this example has no Payload behind it, so `/preview-token` and
 * `/preview-session` stand in for that half.
 */
// The production gate serves this app over TLS on another port and says so.
export const PREVIEW_AUDIENCE = process.env['PAYLOAD_ADMIN_ORIGIN'] ?? 'http://localhost:4176';
export const PREVIEW_TOKEN_SECRET = 'nuxt-example-secret-at-least-32-bytes-long-000';
/** The cookie `/preview-session` writes and the preview hook reads back. */
export const PREVIEW_COOKIE = 'previewToken';
