/**
 * Protocol-version negotiation.
 *
 * The Payload live-preview protocol has grown over time:
 *
 *   - **v1** — original Payload 2.x: data + slug + locale only.
 *   - **v2** — adds `fieldSchemaJSON`, enabling schema-driven type
 *     resolution without DOM annotations.
 *   - **v3** — adds `previewToken`, enabling JWT-gated previews for
 *     multi-tenant admin contexts.
 *   - **v4** — adds nested-array recursion and a richer document-event
 *     payload (this library's contribution).
 *
 * To stay forwards- and backwards-compatible, both sides advertise
 * their highest supported version in the `ready` handshake. The
 * runtime negotiates `min(ours, theirs)` and exposes the result as a
 * capability set the host can branch on without hard-coding numbers.
 *
 * When the remote party does not advertise a version (older Payload
 * builds), we assume `v1` — the conservative default that disables
 * every feature added after the original protocol.
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
