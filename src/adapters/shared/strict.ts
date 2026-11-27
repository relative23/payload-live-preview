/**
 * What an adapter refuses at startup, so a misconfiguration fails the process
 * rather than a public response (ADR 0006). 2.x called it `strict` and could
 * switch it off; 3.0 has no other mode (ADR 0007, row 36).
 */

import { isDevelopmentProcess, warnOnce } from '@/types/dev-warning';
import { resolvePolicyOptions, type PreviewPolicyOptions } from './policy-options';

/** The configuration errors raised at startup rather than on a public response. */
export function assertStrictConfiguration(options: PreviewPolicyOptions): void {
  if (typeof options.authorizePreview !== 'function') {
    throw new Error(
      'payload-live-preview: strict mode requires `authorizePreview` — response changes ' +
        'must be gated on a verified context, not on intent (ADR 0006). Pass a hook that returns ' +
        '`authorizePreviewRequest(request, strategy)` from `payload-live-preview/server` ' +
        '(docs/authorization.md).',
    );
  }
  const origins = options.allowedOrigins ?? [];
  if (origins.length === 0) {
    throw new Error(
      'payload-live-preview: strict mode requires explicit, non-empty `allowedOrigins`. Name the ' +
        "origin of the Payload admin, as in `allowedOrigins: ['https://cms.example.com']`.",
    );
  }
  const plain = origins.filter((origin) => !isHttpsOrigin(origin));
  if (plain.length > 0 && !isDevelopmentProcess()) {
    throw new Error(
      `payload-live-preview: strict mode requires https admin origins in production; got "${plain[0]}". ` +
        'Name the https origin of the admin; http passes only where `NODE_ENV` is not `production`.',
    );
  }
  // Past the refusal `process.env` was readable and not production. Unset counts as
  // development there, which a production server without it is not.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (plain.length > 0 && env?.['NODE_ENV'] === undefined) {
    warnOnce(
      'strict-http-without-node-env',
      `strict mode accepted ${plain.map((origin) => `"${origin}"`).join(', ')} because \`NODE_ENV\` ` +
        'is not set, which it treats as development. Set `NODE_ENV=production` on a production ' +
        'server, and strict mode requires https admin origins there.',
    );
  }
  if (resolvePolicyOptions(options).previewSignals.includes('referer')) {
    throw new Error(
      "payload-live-preview: strict mode disables referrer trust; remove 'referer' from " +
        '`previewSignals`.',
    );
  }
}

/** Unparseable is not https: strict mode may not fall through to "fine". */
function isHttpsOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'https:';
  } catch {
    return false;
  }
}
