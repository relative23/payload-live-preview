/**
 * What the peer does, derived from the capabilities its messages showed —
 * the runtime never asks which Payload version it is talking to. Unknown
 * until the admin reveals its shape. See ADR 0010.
 */
import type { ProtocolCapability } from './protocol-version';

export type ProtocolProfileName = 'unknown' | 'payload-2' | 'payload-3';

export interface ProtocolProfile {
  /** `payload-2` names an admin this package no longer serves: its updates are refused (LP0504). */
  readonly name: ProtocolProfileName;
  /** Whether the peer reports document saves and relationship edits. */
  readonly documentEvents: boolean;
}

const PAYLOAD_2: ProtocolProfile = { name: 'payload-2', documentEvents: false };
const PAYLOAD_3: ProtocolProfile = { name: 'payload-3', documentEvents: true };
const UNKNOWN: ProtocolProfile = { name: 'unknown', documentEvents: false };

/**
 * `schema-json` on the wire is the Payload 2.x signature: 3.x removed
 * `fieldSchemaJSON`. Document or relationship events are 3.x-only. Until
 * either shows, the peer is unknown. Every peer is merged through the server.
 */
export function detectProtocolProfile(observed: ReadonlySet<ProtocolCapability>): ProtocolProfile {
  if (observed.has('schema-json')) return PAYLOAD_2;
  if (observed.has('document-events') || observed.has('relationship-events')) return PAYLOAD_3;
  return UNKNOWN;
}
