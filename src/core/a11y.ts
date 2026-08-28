/**
 * One polite `aria-live` region per document, leased by every announcer on
 * the page, for connect / update / disconnect announcements. The message
 * clears itself after a moment so a repeated string is heard again.
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

/** Shared per document; reference-counted so one client cannot remove another's region. */
interface DocumentLease {
  element: HTMLElement | null;
  /** Created by this package (removable) rather than adopted from the page. */
  owned: boolean;
  messageNode: Text | null;
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const documentLeases = new WeakMap<Document, DocumentLease>();

function acquireDocumentLease(activeDocument: Document): DocumentLease {
  let lease = documentLeases.get(activeDocument);
  if (lease === undefined) {
    lease = { element: null, owned: false, messageNode: null, refs: 0, timer: null };
    documentLeases.set(activeDocument, lease);
  }
  lease.refs += 1;
  return lease;
}

/** Remove only the package-owned message node, never consumer children. */
function clearLeaseMessage(lease: DocumentLease): void {
  if (lease.timer !== null) {
    clearTimeout(lease.timer);
    lease.timer = null;
  }
  lease.messageNode?.remove();
  lease.messageNode = null;
}

export class A11yAnnouncer {
  private readonly german: boolean;
  private readonly document: Document | null;
  private lease: DocumentLease | null = null;

  constructor(locale?: string, targetDocument?: Document | null) {
    const activeDocument = targetDocument ?? (typeof document === 'undefined' ? null : document);
    const documentLocale = activeDocument?.documentElement.getAttribute('lang') ?? '';
    this.german = isGerman(
      locale ?? (documentLocale.length > 0 ? documentLocale : detectInitialLocale()),
    );
    this.document = activeDocument;
    // The region mounts on the first announcement: a <head> inline script runs before `body` exists.
  }

  /** The shared region, or `null` without a body yet (announcements are then dropped). */
  private mount(): HTMLElement | null {
    const activeDocument = this.document;
    if (activeDocument?.body == null) return null;
    this.lease ??= acquireDocumentLease(activeDocument);
    const lease = this.lease;
    const leased = lease.element;
    if (leased?.isConnected && leased.ownerDocument === activeDocument) return leased;
    // The host removed or replaced the region between announcements.
    if (leased !== null) {
      const owned = lease.owned;
      clearLeaseMessage(lease);
      if (owned) leased.remove();
    }
    let element = activeDocument.getElementById(ELEMENT_ID);
    lease.owned = element === null;
    if (element === null) {
      element = activeDocument.createElement('div');
      element.id = ELEMENT_ID;
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      element.setAttribute('aria-atomic', 'true');
      element.setAttribute('style', STYLE);
      activeDocument.body.appendChild(element);
    }
    lease.element = element;
    return element;
  }

  announceConnected(): void {
    this.say(this.german ? 'Vorschau verbunden' : 'Live preview connected');
  }

  announceDisconnected(): void {
    this.say(this.german ? 'Vorschau getrennt' : 'Live preview disconnected');
  }

  announceUpdate(count: number): void {
    if (count <= 0) return;
    this.say(
      this.german
        ? `${String(count)} ${count === 1 ? 'Änderung' : 'Änderungen'} angewendet`
        : `${String(count)} ${count === 1 ? 'change' : 'changes'} applied`,
    );
  }

  /** Release the lease; the last release removes an owned region but leaves an adopted one. Idempotent. */
  detach(): void {
    const lease = this.lease;
    const activeDocument = this.document;
    if (lease === null || activeDocument === null) return;
    this.lease = null;
    lease.refs -= 1;
    if (lease.refs > 0) return;
    const element = lease.element;
    if (element !== null) clearLeaseMessage(lease);
    if (lease.owned) element?.remove();
    lease.element = null;
    documentLeases.delete(activeDocument);
  }

  private say(message: string): void {
    const element = this.mount();
    const lease = this.lease;
    if (element === null || lease === null) return;
    let messageNode = lease.messageNode;
    if (messageNode?.parentNode !== element) {
      // A dedicated text node leaves consumer-owned children untouched.
      messageNode?.remove();
      messageNode = element.ownerDocument.createTextNode(
        element.hasChildNodes() ? ` ${message}` : message,
      );
      lease.messageNode = messageNode;
      element.appendChild(messageNode);
    } else {
      messageNode.data = messageNode.previousSibling === null ? message : ` ${message}`;
    }
    if (lease.timer !== null) clearTimeout(lease.timer);
    const timer = setTimeout(() => {
      if (lease.timer === timer && lease.element === element) clearLeaseMessage(lease);
    }, CLEAR_DELAY_MS);
    lease.timer = timer;
  }
}
