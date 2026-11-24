/**
 * The private variables the fixture reads, declared as SvelteKit 3 requires.
 * A missing one arrives as the empty string, which `src/lib/preview.server.ts`
 * treats as unset: development keeps its loopback origin and test secret.
 */
import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  PAYLOAD_ADMIN_ORIGIN: { schema: (input) => input ?? '' },
  PREVIEW_TOKEN_SECRET: { schema: (input) => input ?? '' },
  PLP_PAYLOAD_SERVER_URL: { schema: (input) => input ?? '' },
});
