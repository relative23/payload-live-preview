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
export const PREVIEW_AUDIENCE = 'http://localhost:4175';
export const PREVIEW_TOKEN_SECRET = 'sveltekit-example-secret-at-least-32-bytes-long';
