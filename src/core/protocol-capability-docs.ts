/**
 * What each protocol capability gates, and the fallback without it — the
 * "degrades by declaration" half of ADR 0010, kept apart from the rules the
 * inline runtime ships. Consumers can read it for diagnostics; the unit
 * tests refuse a capability without an entry here.
 *
 * @module @core/protocol-capability-docs
 */
import type { ProtocolCapability } from './protocol-version';

export interface CapabilityDocumentation {
  /** The runtime behaviour that depends on the capability. */
  readonly gates: string;
  /** What the runtime does without it. */
  readonly fallback: string;
}

export const CAPABILITY_DOCUMENTATION: Readonly<
  Record<ProtocolCapability, CapabilityDocumentation>
> = {
  basic: {
    gates: 'data updates are applied to bound elements',
    fallback: 'none — every peer has it',
  },
  'schema-json': {
    gates: 'field typing from fieldSchemaJSON (Payload 2.x) and the payload-2 profile',
    fallback: 'field types come from DOM heuristics and Lexical auto-detection',
  },
  locale: {
    gates:
      'locale-aware field resolution (`title_de` before `title`) and the locale on island events',
    fallback: 'bindings resolve the unsuffixed field value',
  },
  'preview-token': {
    gates: 'per-message token validation (library extension)',
    fallback: 'messages carry no token; validateToken cannot be satisfied',
  },
  'nested-arrays': {
    gates: 'keyed array diffs below the top level',
    fallback: 'array updates replace the whole array',
  },
  'recursive-diffs': {
    gates: 'recursive object diffs',
    fallback: 'nested objects re-render as a unit',
  },
  'document-events': {
    gates: 'the `documentSave` runtime event, the document-save plugin and the payload-3 profile',
    fallback: 'no documentSave event; a save is not distinguishable from an edit',
  },
  'relationship-events': {
    gates:
      'the `relationshipUpdate` runtime event and an unconditional re-render of the update that carries it',
    fallback: 'a related document edited in a drawer shows up on the next data update only',
  },
};
