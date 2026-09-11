/**
 * What `strict` refuses at startup, so a misconfiguration fails the process
 * rather than a public response (ADR 0006).
 */

import { isDevelopmentProcess } from './dev-warning';
import { resolvePolicyOptions, type PreviewPolicyOptions } from './policy-options';

/**
 * The sentence every strict refusal ends with.
 *
 * Each of these rules is new in 2.0, and the process that stops is one that
 * worked yesterday. Saying only the rule leaves an upgrader to find out that
 * there is a staged path at all — so the way out is in the message that stops
 * them, not only in the guide they have not opened yet.
 */
const STAGED =
  " New in 2.0; `defaults: 'v1'` keeps the 1.x table while you migrate (docs/migration.md).";

/** The configuration errors `strict` exists to raise, at startup rather than on a public response. */
export function assertStrictConfiguration(options: PreviewPolicyOptions): void {
  if (typeof options.authorizePreview !== 'function') {
    throw new Error(
      'payload-live-preview: strict mode requires `authorizePreview` — response changes ' +
        'must be gated on a verified context, not on intent (ADR 0006).' +
        STAGED,
    );
  }
  const origins = options.allowedOrigins ?? [];
  if (origins.length === 0) {
    throw new Error(
      'payload-live-preview: strict mode requires explicit, non-empty `allowedOrigins`.' + STAGED,
    );
  }
  if (!isDevelopmentProcess()) {
    for (const origin of origins) {
      let protocol: string | undefined;
      try {
        protocol = new URL(origin).protocol;
      } catch {
        protocol = undefined;
      }
      if (protocol !== 'https:') {
        throw new Error(
          `payload-live-preview: strict mode requires https admin origins in production; got "${origin}".` +
            STAGED,
        );
      }
    }
  }
  // The resolved signals, not the option: `defaults: 'v1'` fills in `referer`.
  if (resolvePolicyOptions(options).previewSignals?.includes('referer') === true) {
    throw new Error(
      "payload-live-preview: strict mode disables referrer trust; remove 'referer' from " +
        "`previewSignals` (the 'v1' profile includes it).",
    );
  }
}
