/**
 * Screen-reader live region.
 *
 * Mounts a single visually-hidden `<div role="status" aria-live="polite">`
 * into the document and pushes short messages to it on connect /
 * after-update / disconnect events.
 *
 * Why this matters: an editor using assistive technology hears
 * "Vorschau verbunden" / "5 Inhalte aktualisiert" instead of silently
 * watching the page mutate. The v0.1.0 line had this feature; the
 * 1.0.0 rewrite restores it.
 *
 * Design rules:
 *   - **Exactly one** live region per document, regardless of how many
 *     `LivePreviewClient` instances run on the page. Every announcer leases
 *     that region independently.
 *   - Polite — never interrupts ongoing speech (`aria-live="polite"`).
 *   - Throttled — clears itself after a short window so re-announcement
 *     of the same string is heard a second time. Without the clear,
 *     screen readers de-duplicate identical messages.
 *   - Localized — strings come from the active locale via
 *     `detectInitialLocale()`. Untranslated locales fall back to
 *     English.
 *
 * @module @core/a11y
 */

import { detectInitialLocale } from '@detection/locale';

const ELEMENT_ID = 'payload-live-preview-a11y';
const CLEAR_DELAY_MS = 1500;
const STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';

function isGerman(locale: string): boolean {
  return /^de(?:[-_]|$)/i.test(locale);
}

const enum LeaseSlot {
  Element,
  Owned,
  MessageNode,
  Refs,
  Timer,
}

type DocumentLease = [
  element: HTMLElement | null,
  owned: boolean,
  messageNode: Text | null,
  refs: number,
  timer: ReturnType<typeof setTimeout> | null,
];

const enum AnnouncerSlot {
  German,
  Document,
  Lease,
}

type AnnouncerState = [german: boolean, document: Document | null, lease: DocumentLease | null];

/**
 * DOM-keyed coordination must not retain discarded documents. The lease owns the
 * one shared timer as well as the region ownership flag, so one client can neither
 * clear a newer announcement nor remove a region that another client still uses.
 */
const documentLeases = new WeakMap<Document, DocumentLease>();

function acquireDocumentLease(activeDocument: Document): DocumentLease {
  let lease = documentLeases.get(activeDocument);
  lease ??= [null, false, null, 0, null];
  documentLeases.set(activeDocument, lease);
  lease[LeaseSlot.Refs] += 1;
  return lease;
}

/** Remove only the package-owned message node, never consumer child nodes. */
function clearLeaseMessage(lease: DocumentLease): void {
  if (lease[LeaseSlot.Timer] !== null) {
    clearTimeout(lease[LeaseSlot.Timer]);
    lease[LeaseSlot.Timer] = null;
  }
  lease[LeaseSlot.MessageNode]?.remove();
  lease[LeaseSlot.MessageNode] = null;
}

/**
 * Per-document live region. Announcers that successfully mount share a
 * reference-counted lease until each one detaches.
 */
export class A11yAnnouncer {
  // This class is internal to the runtime bundle. TypeScript-private members
  // preserve encapsulation without forcing ES2020 builds to lower every field
  // and method into separate WeakMaps/WeakSets.
  private readonly s: AnnouncerState;

  constructor(locale?: string, targetDocument?: Document | null) {
    const activeDocument = targetDocument ?? (typeof document === 'undefined' ? null : document);
    const documentLocale = activeDocument?.documentElement.getAttribute('lang') ?? '';
    this.s = [
      isGerman(locale ?? (documentLocale.length > 0 ? documentLocale : detectInitialLocale())),
      activeDocument,
      null,
    ];
    // The live region is mounted lazily on first announcement: the
    // announcer is constructed during runtime bootstrap, which can run
    // from a <head> inline script while `document.body` is still null.
  }

  /**
   * Create (or adopt) the shared live-region element. Returns `null`
   * when no DOM is available yet — announcements are then dropped,
   * which is fine: they are progress niceties, not state.
   */
  private mount(): HTMLElement | null {
    // lib.dom types body as always-present, but during <head> execution
    // it genuinely is null.
    const activeDocument = this.s[AnnouncerSlot.Document];
    if (activeDocument?.body == null) return null;

    let lease = this.s[AnnouncerSlot.Lease];
    if (lease === null) {
      lease = acquireDocumentLease(activeDocument);
      this.s[AnnouncerSlot.Lease] = lease;
    }

    const leasedElement = lease[LeaseSlot.Element];
    if (leasedElement?.isConnected && leasedElement.ownerDocument === activeDocument) {
      return leasedElement;
    }

    // A host can remove or replace the adopted region between announcements.
    // Revoke only our node before leasing the current element.
    if (leasedElement !== null) {
      const owned = lease[LeaseSlot.Owned];
      clearLeaseMessage(lease);
      if (owned) leasedElement.remove();
    }

    let element: HTMLElement | null = activeDocument.getElementById(ELEMENT_ID);
    lease[LeaseSlot.Owned] = element === null;
    if (!element) {
      element = activeDocument.createElement('div');
      element.id = ELEMENT_ID;
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      element.setAttribute('aria-atomic', 'true');
      element.setAttribute('style', STYLE);
      activeDocument.body.appendChild(element);
    }
    lease[LeaseSlot.Element] = element;
    return element;
  }

  /** Announce that the preview successfully connected. */
  announceConnected(): void {
    this.say(this.s[AnnouncerSlot.German] ? 'Vorschau verbunden' : 'Live preview connected');
  }

  /** Announce that the preview lost its connection. */
  announceDisconnected(): void {
    this.say(this.s[AnnouncerSlot.German] ? 'Vorschau getrennt' : 'Live preview disconnected');
  }

  /** Announce that `count` updates were applied. */
  announceUpdate(count: number): void {
    if (count <= 0) return;
    this.say(
      this.s[AnnouncerSlot.German]
        ? `${String(count)} ${count === 1 ? 'Änderung' : 'Änderungen'} angewendet`
        : `${String(count)} ${count === 1 ? 'change' : 'changes'} applied`,
    );
  }

  /**
   * Release this announcer's live-region lease. The final release removes a
   * package-owned region but leaves an adopted consumer element in place.
   * Called by the runtime during `destroy()`. Idempotent.
   */
  detach(): void {
    const lease = this.s[AnnouncerSlot.Lease];
    const activeDocument = this.s[AnnouncerSlot.Document];
    if (lease === null || activeDocument === null) return;

    // Clear local ownership first so re-entrant or repeated detach calls cannot
    // release somebody else's reference.
    this.s[AnnouncerSlot.Lease] = null;
    lease[LeaseSlot.Refs] -= 1;
    if (lease[LeaseSlot.Refs] > 0) return;

    const element = lease[LeaseSlot.Element];
    if (element !== null) clearLeaseMessage(lease);
    if (lease[LeaseSlot.Owned]) element?.remove();
    lease[LeaseSlot.Element] = null;
    documentLeases.delete(activeDocument);
  }

  private say(message: string): void {
    const element = this.mount();
    const lease = this.s[AnnouncerSlot.Lease];
    if (element === null || lease === null) return;

    let messageNode = lease[LeaseSlot.MessageNode];
    if (messageNode?.parentNode !== element) {
      // If consumer code reparented our prior node, it remains package-owned:
      // revoke it before replacing the lease pointer so detach cannot orphan it.
      messageNode?.remove();
      // Appending a dedicated text node leaves every consumer-owned child in
      // place throughout the announcement, preserving identity and listeners.
      messageNode = element.ownerDocument.createTextNode(
        element.hasChildNodes() ? ` ${message}` : message,
      );
      lease[LeaseSlot.MessageNode] = messageNode;
      element.appendChild(messageNode);
    } else {
      messageNode.data = messageNode.previousSibling === null ? message : ` ${message}`;
    }
    if (lease[LeaseSlot.Timer] !== null) clearTimeout(lease[LeaseSlot.Timer]);
    const timer = setTimeout(() => {
      if (lease[LeaseSlot.Timer] === timer && lease[LeaseSlot.Element] === element) {
        clearLeaseMessage(lease);
      }
    }, CLEAR_DELAY_MS);
    lease[LeaseSlot.Timer] = timer;
  }
}
