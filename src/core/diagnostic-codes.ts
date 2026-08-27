/**
 * Stable identifiers for everything the runtime reports.
 *
 * Prose gets reworded; a code does not. A consumer filtering logs, an alert
 * rule, or a bug report referring to `LP0301` keeps meaning the same thing
 * after the sentence around it is rewritten, and a code is greppable in a way
 * that a sentence fragment is not.
 *
 * Codes are grouped by the question they answer:
 *
 * - `LP01xx` — configuration and origin trust: the runtime is running, but it
 *   was set up in a way that will bite.
 * - `LP02xx` — bindings and markup: an update had nowhere to land.
 * - `LP03xx` — updates and scheduling: the update landed somewhere other than
 *   the DOM, or not yet.
 * - `LP04xx` — rendering: a value reached an element and was refused.
 * - `LP05xx` — protocol and messages: something arrived that was not accepted.
 * - `LP06xx` — consumer callbacks: code the consumer supplied threw.
 * - `LP07xx` — audit findings from `pll doctor`, which reports on a served
 *   response rather than on a running runtime.
 *
 * A code is part of the public contract. Codes are never reused for a
 * different meaning and never renumbered; a retired code stays retired.
 * `LP0604` is unassigned: a throwing token validator is deliberately treated
 * as a rejection and reported as `LP0502`, so there is nothing distinct to
 * report yet. The number stays reserved rather than being handed to something
 * else.
 *
 * The runtime writes these as string literals at each reporting site rather
 * than reading them from this record, so the inline build pays for the six
 * characters it prints and nothing more. This record exists so consumers can
 * refer to a code by name instead of copying a literal.
 *
 * @module @core/diagnostic-codes
 */

/**
 * Every diagnostic code the runtime can report, by name.
 *
 * ```ts
 * client.events.on('error', (e) => {
 *   if (e.code === DIAGNOSTIC_CODES.TransformThrew) reportToSentry(e.error);
 * });
 * ```
 */
export const DIAGNOSTIC_CODES = Object.freeze({
  /** No trusted origin configured in production; nothing will be accepted. */
  NoTrustedOrigin: 'LP0101',
  /** Origin trust rests on `document.referrer`, so any framing site is trusted. */
  ReferrerOnlyTrust: 'LP0102',

  /** An update named a field with no binding anchor on the page. */
  OrphanField: 'LP0201',
  /** Owner scoping is on and the update names no document it could belong to. */
  UnattributableUpdate: 'LP0202',

  /** The visibility gate held offscreen writes back until they scroll into view. */
  VisibilityGateDeferred: 'LP0301',

  /** A value was refused because the attribute or the value itself is unsafe. */
  UnsafeAttributeWrite: 'LP0401',
  /** A text element has structured children, so replacing its text was skipped. */
  TextTargetHasChildren: 'LP0402',
  /** A structural container has no array template, so the update was skipped. */
  MissingArrayTemplate: 'LP0403',
  /** A structural item has no `id`; it pairs positionally, so an insert re-renders every row after it. */
  StructuralItemUnkeyed: 'LP0404',
  /** Two structural items share a key; later ones pair positionally. */
  StructuralDuplicateKey: 'LP0405',
  /** Every structural key changed while the length did not; the source generates keys per message. */
  StructuralUnstableKeys: 'LP0406',

  /** A message was rejected before it reached the update pipeline. */
  MessageRejected: 'LP0501',
  /** A preview token was rejected. */
  TokenRejected: 'LP0502',

  /** A consumer event handler threw. */
  HandlerThrew: 'LP0601',
  /** A consumer transform threw; the original value was kept. */
  TransformThrew: 'LP0602',
  /** A renderer threw while writing a value. */
  RendererThrew: 'LP0603',
  /** Runtime startup failed. */
  StartupFailed: 'LP0605',
  /** Sending the ready handshake failed. */
  ReadyFailed: 'LP0606',

  /** The audit found no runtime in a response that carried preview intent. */
  AuditRuntimeMissing: 'LP0701',
  /** The preview response declares no `frame-ancestors`. */
  AuditNoFrameAncestors: 'LP0702',
  /** `X-Frame-Options` forbids framing, which no CSP can undo. */
  AuditFrameOptionsBlocks: 'LP0703',
  /** Binding attributes are served to anonymous visitors. */
  AuditBindingsExposed: 'LP0704',
  /** More bindings than the default visibility gate will write eagerly. */
  AuditGateThresholdExceeded: 'LP0705',
  /** Owner markers exist, but some bindings are outside all of them. */
  AuditUnownedBindings: 'LP0706',
  /** The preview response carries no bindings at all. */
  AuditNoBindings: 'LP0707',
  /** The URL did not return an HTML page, so nothing else can be judged. */
  AuditNotAPage: 'LP0708',
} as const);

/** A diagnostic code, as it appears in log output and on the `error` event. */
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];
