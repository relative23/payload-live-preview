/**
 * Fixture-only preview settings. A real deployment keeps the secret in the
 * environment and lets Payload mint the token inside its `livePreview.url`
 * callback; this example has no Payload behind it, so `/preview-token` stands
 * in for that half.
 */
export const PREVIEW_AUDIENCE = 'http://localhost:4176';
export const PREVIEW_TOKEN_SECRET = 'nuxt-example-secret-at-least-32-bytes-long-000';
