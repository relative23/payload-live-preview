/**
 * What the peer does, derived from the capabilities its messages showed —
 * the runtime never asks which Payload version it is talking to. Unknown
 * until the admin reveals its shape. See ADR 0010.
 */
import type { ProtocolCapability } from './protocol-version';

export type ProtocolProfileName = 'unknown' | 'payload-2' | 'payload-3';

export interface ProtocolProfile {
  readonly name: ProtocolProfileName;
  /** Where field types come from. */
  readonly fieldTyping: 'schema' | 'heuristic';
  /**
   * Who populates relationships. Payload 2.x's admin posts populated data
   * (it merges client-side with `fieldSchemaJSON`); Payload 3.x posts raw
   * form values and the runtime asks the REST API when `serverURL` is set.
   */
  readonly populatesRelationships: 'admin' | 'server';
  /** Whether the peer reports document saves and relationship edits. */
  readonly documentEvents: boolean;
}

const PAYLOAD_2: ProtocolProfile = {
  name: 'payload-2',
  fieldTyping: 'schema',
  populatesRelationships: 'admin',
  documentEvents: false,
};
const PAYLOAD_3: ProtocolProfile = {
  name: 'payload-3',
  fieldTyping: 'heuristic',
  populatesRelationships: 'server',
  documentEvents: true,
};
const UNKNOWN: ProtocolProfile = {
  name: 'unknown',
  fieldTyping: 'heuristic',
  populatesRelationships: 'server',
  documentEvents: false,
};

/**
 * `schema-json` on the wire is the Payload 2.x signature: 3.x removed
 * `fieldSchemaJSON`. Document or relationship events are 3.x-only. Until
 * either shows, the peer is unknown and treated like 3.x for merging — the
 * conservative choice, because a needless REST merge costs a request while
 * a missing one loses populated relationships.
 */
export function detectProtocolProfile(observed: ReadonlySet<ProtocolCapability>): ProtocolProfile {
  if (observed.has('schema-json')) return PAYLOAD_2;
  if (observed.has('document-events') || observed.has('relationship-events')) return PAYLOAD_3;
  return UNKNOWN;
}
