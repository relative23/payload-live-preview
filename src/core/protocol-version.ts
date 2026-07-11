/**
 * Protocol-version negotiation.
 *
 * ⚠️ Reality check: **stock Payload does not version its live-preview
 * postMessage protocol.** The admin never sends a `protocolVersion`
 * field and ignores extra fields in our `ready` handshake. Observed
 * wire behaviour:
 *
 *   - Payload **2.x** sent `fieldSchemaJSON` with the first update
 *     (client-side merge era).
 *   - Payload **3.x** removed `fieldSchemaJSON` entirely; the official
 *     client re-fetches merged documents through the REST API instead.
 *   - No Payload version sends `previewToken` or any keepalive.
 *
 * This module therefore only matters for NON-stock admin panels — a
 * custom `window.postMessage` sender can advertise a version and this
 * library will negotiate `min(ours, theirs)` and expose capability
 * flags. Against stock Payload, `theirs` stays `undefined`, negotiation
 * collapses to v1, and nothing is gated on it: schema handling
 * activates whenever `fieldSchemaJSON` is actually present, and token
 * validation only runs when the consumer opts in.
 *
 * Version ladder (this library's own numbering, not Payload's):
 *
 *   - **v1** — data + slug + locale (matches stock Payload of any era).
 *   - **v2** — remote sends `fieldSchemaJSON` (Payload 2.x behaviour).
 *   - **v3** — remote sends `previewToken` (custom senders only).
 *   - **v4** — nested-array recursion / richer document events
 *     (custom senders only).
 *
 * @module @core/protocol-version
 */

export const LIBRARY_PROTOCOL_VERSION = 4;

/** Capability flag → minimum protocol version it requires. */
const CAPABILITY_REQUIREMENTS: Readonly<Record<string, number>> = {
  basic: 1,
  'schema-json': 2,
  'preview-token': 3,
  'nested-arrays': 4,
  'recursive-diffs': 4,
} as const;

export type ProtocolCapability = keyof typeof CAPABILITY_REQUIREMENTS;

export interface ProtocolNegotiation {
  /** This library's protocol version. */
  readonly ours: number;
  /** The remote party's version, when known. */
  readonly theirs: number | undefined;
  /** `min(ours, theirs ?? 1)` — the version both sides actually share. */
  readonly negotiated: number;
  /** Capability flags enabled at the negotiated version. */
  readonly capabilities: ReadonlySet<string>;
}

/**
 * Compute the negotiated view of the protocol.
 *
 * `theirs === undefined` collapses to v1 — assume the remote party is
 * an older Payload that does not advertise a version.
 *
 * Non-finite or non-positive `theirs` values fall back to v1 as well —
 * we never trust an obviously-corrupted negotiation byte.
 */
export function negotiateProtocol(theirs: number | undefined): ProtocolNegotiation {
  const sanitisedTheirs =
    typeof theirs === 'number' && Number.isFinite(theirs) && theirs >= 1
      ? Math.floor(theirs)
      : undefined;
  const effectiveTheirs = sanitisedTheirs ?? 1;
  const negotiated = Math.min(LIBRARY_PROTOCOL_VERSION, effectiveTheirs);
  const capabilities = new Set<string>();
  for (const [flag, minVersion] of Object.entries(CAPABILITY_REQUIREMENTS)) {
    if (negotiated >= minVersion) capabilities.add(flag);
  }
  return {
    ours: LIBRARY_PROTOCOL_VERSION,
    ...(sanitisedTheirs !== undefined ? { theirs: sanitisedTheirs } : { theirs: undefined }),
    negotiated,
    capabilities,
  };
}

export function hasCapability(
  negotiation: ProtocolNegotiation,
  capability: ProtocolCapability,
): boolean {
  return negotiation.capabilities.has(capability);
}
