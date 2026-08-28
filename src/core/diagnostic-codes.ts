/**
 * Every diagnostic code the runtime and tools emit, so a consumer can branch
 * on `e.code` instead of matching message text. A code is never reused for a
 * different meaning; a retired one stays reserved.
 *
 * Browser-side reporting sites write the literal (`code: 'LP0603'`) rather than
 * reading it from this record: the frozen table would then ship in the inline
 * runtime for the sake of six characters. Server-side tools may import it.
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
  /** A plugin declares a runtime range this runtime does not satisfy; it was refused. */
  PluginIncompatible: 'LP0103',

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
  /** A binding asks for a delivery strategy this release does not have; it is left unchanged. */
  UnsupportedStrategy: 'LP0407',

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
  /** A fragment request failed (network, timeout, server error); the boundary was patched instead. */
  FragmentRequestFailed: 'LP0801',
  /** The fragment response had the wrong content type or shape; the boundary was patched instead. */
  FragmentResponseInvalid: 'LP0802',
  /** The fragment endpoint refused the preview (not authorized); the boundary was patched instead. */
  FragmentUnauthorized: 'LP0803',
  /** A fragment response arrived for a revision that was already superseded and was discarded. */
  FragmentSuperseded: 'LP0804',
  /** A route refresh was requested again for the same revision; the loop guard stopped it. */
  RouteRefreshLoop: 'LP0805',
  /** A boundary asks for the fragment strategy but no fragment handler is configured; it is patched. */
  FragmentStrategyUnavailable: 'LP0806',
  /** A readiness row is not yet at its 2.0 value; `pll doctor --v2` reports it. */
  V2ReadinessGap: 'LP0709',
  /** The preview runtime is served to anonymous visitors, not only inside the admin frame. */
  RuntimeOnPublicPage: 'LP0710',
} as const);

/** A diagnostic code, as it appears in log output and on the `error` event. */
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];
