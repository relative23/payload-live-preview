/**
 * Protocol negotiation and capabilities (roadmap 1.8.0).
 *
 * A capability names one behaviour the runtime branches on. It is enabled
 * either by the negotiated protocol version — for what this library and a
 * peer that announces a version agree on — or by observation: the stock
 * Payload admin announces no version, so what it can do is read off the
 * messages it actually sends (a schema, a locale, a document event). Each
 * capability declares the fallback the runtime takes without it, so a
 * Payload that lacks one degrades by declaration rather than by exception.
 *
 * @module @core/protocol-version
 */

/**
 * Bumps only when THIS library's understanding of the wire format changes.
 * The stock Payload admin never sends a version; `theirs` stays undefined
 * for it and its capabilities are observed instead.
 */
export const LIBRARY_PROTOCOL_VERSION = 4;

/** How a capability becomes active. */
export type CapabilitySource = 'version' | 'observed';

export interface CapabilityDeclaration {
  /** Enabled once the negotiated version reaches this (for announced peers). */
  readonly since: number;
  /**
   * Enabled once a message shows the feature (for peers that announce no
   * version). Absent for capabilities only a version can grant.
   */
  readonly observed?:
    'schema' | 'locale' | 'preview-token' | 'document-event' | 'relationship-event';
}

/**
 * What activates each capability. What it gates and what the runtime does
 * without it is documented next to it in `CAPABILITY_DOCUMENTATION`
 * (`@core/protocol-capability-docs`), kept out of this module so the inline
 * runtime carries the rules and not the prose.
 */
export const CAPABILITY_DECLARATIONS = {
  basic: { since: 1 },
  'schema-json': { since: 2, observed: 'schema' },
  locale: { since: 2, observed: 'locale' },
  'preview-token': { since: 3, observed: 'preview-token' },
  'nested-arrays': { since: 4 },
  'recursive-diffs': { since: 4 },
  'document-events': { since: 4, observed: 'document-event' },
  'relationship-events': { since: 4, observed: 'relationship-event' },
} as const satisfies Record<string, CapabilityDeclaration>;

export type ProtocolCapability = keyof typeof CAPABILITY_DECLARATIONS;

/** Every declared capability, in declaration order. */
export const PROTOCOL_CAPABILITIES = Object.keys(
  CAPABILITY_DECLARATIONS,
) as readonly ProtocolCapability[];

export interface ProtocolNegotiation {
  /** This library's protocol version. */
  readonly ours: number;
  /** The remote party's version, when it announced one. */
  readonly theirs: number | undefined;
  /** `min(ours, theirs ?? 1)` — the version both sides actually share. */
  readonly negotiated: number;
  /** Capabilities active at the negotiated version or seen on the wire. */
  readonly capabilities: ReadonlySet<ProtocolCapability>;
  /** The subset that was observed on the wire rather than granted by version. */
  readonly observed: ReadonlySet<ProtocolCapability>;
}

/**
 * Negotiate from an announced version and the capabilities observed so far.
 * Deterministic and side-effect free; the runtime re-runs it whenever
 * either input changes.
 */
export function negotiateProtocol(
  theirs: number | undefined,
  observed: Iterable<ProtocolCapability> = [],
): ProtocolNegotiation {
  const sanitisedTheirs =
    typeof theirs === 'number' && Number.isFinite(theirs) && theirs >= 1
      ? Math.floor(theirs)
      : undefined;
  const effectiveTheirs = sanitisedTheirs ?? 1;
  const negotiated = Math.min(LIBRARY_PROTOCOL_VERSION, effectiveTheirs);
  const seen = new Set<ProtocolCapability>(observed);
  const capabilities = new Set<ProtocolCapability>();
  for (const capability of PROTOCOL_CAPABILITIES) {
    if (negotiated >= CAPABILITY_DECLARATIONS[capability].since || seen.has(capability)) {
      capabilities.add(capability);
    }
  }
  return {
    ours: LIBRARY_PROTOCOL_VERSION,
    ...(sanitisedTheirs !== undefined ? { theirs: sanitisedTheirs } : { theirs: undefined }),
    negotiated,
    capabilities,
    observed: seen,
  };
}

export function hasCapability(
  negotiation: ProtocolNegotiation,
  capability: ProtocolCapability,
): boolean {
  return negotiation.capabilities.has(capability);
}

/** The capabilities a single message demonstrates, by its shape alone. */
export function observeCapabilities(message: {
  readonly fieldSchemaJSON?: unknown;
  readonly locale?: unknown;
  readonly previewToken?: unknown;
  readonly externallyUpdatedRelationship?: unknown;
}): readonly ProtocolCapability[] {
  const seen: ProtocolCapability[] = [];
  if (Array.isArray(message.fieldSchemaJSON)) seen.push('schema-json');
  if (typeof message.locale === 'string') seen.push('locale');
  if (typeof message.previewToken === 'string') seen.push('preview-token');
  if (
    typeof message.externallyUpdatedRelationship === 'object' &&
    message.externallyUpdatedRelationship !== null
  ) {
    seen.push('relationship-events');
  }
  return seen;
}
