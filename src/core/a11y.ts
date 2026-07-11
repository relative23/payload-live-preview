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
 *   - **Exactly one** announcer per document, regardless of how many
 *     `LivePreviewClient` instances run on the page. Subsequent
 *     constructions are no-ops and reuse the existing element.
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
const STYLE = [
  'position:absolute',
  'width:1px',
  'height:1px',
  'padding:0',
  'margin:-1px',
  'overflow:hidden',
  'clip:rect(0 0 0 0)',
  'clip-path:inset(50%)',
  'white-space:nowrap',
  'border:0',
].join(';');

interface Messages {
  readonly connected: string;
  readonly disconnected: string;
  readonly updated: (count: number) => string;
}

const FALLBACK_STRINGS: Messages = {
  connected: 'Live preview connected',
  disconnected: 'Live preview disconnected',
  updated: (n) => `${String(n)} ${n === 1 ? 'change' : 'changes'} applied`,
};

const STRINGS: Readonly<Record<string, Messages>> = {
  en: FALLBACK_STRINGS,
  de: {
    connected: 'Vorschau verbunden',
    disconnected: 'Vorschau getrennt',
    updated: (n) => `${String(n)} ${n === 1 ? 'Änderung' : 'Änderungen'} angewendet`,
  },
};

function resolveStrings(locale: string): Messages {
  const lang = locale.split(/[-_]/)[0]?.toLowerCase() ?? 'en';
  return STRINGS[lang] ?? FALLBACK_STRINGS;
}

/**
 * Per-document live region. Constructing an announcer reuses any
 * existing instance — the first caller "wins" and the others share
 * the same DOM node.
 */
export class A11yAnnouncer {
  readonly #element: HTMLElement | null;
  readonly #strings: Messages;
  #clearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(locale: string = detectInitialLocale()) {
    this.#strings = resolveStrings(locale);
    if (typeof document === 'undefined') {
      this.#element = null;
      return;
    }
    let element: HTMLElement | null = document.getElementById(ELEMENT_ID);
    if (!element) {
      element = document.createElement('div');
      element.id = ELEMENT_ID;
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      element.setAttribute('aria-atomic', 'true');
      element.setAttribute('style', STYLE);
      document.body.appendChild(element);
    }
    this.#element = element;
  }

  /** Announce that the preview successfully connected. */
  announceConnected(): void {
    this.#say(this.#strings.connected);
  }

  /** Announce that the preview lost its connection. */
  announceDisconnected(): void {
    this.#say(this.#strings.disconnected);
  }

  /** Announce that `count` updates were applied. */
  announceUpdate(count: number): void {
    if (count <= 0) return;
    this.#say(this.#strings.updated(count));
  }

  /**
   * Remove the live region from the document. Called by the runtime
   * during `destroy()`. Idempotent.
   */
  detach(): void {
    if (this.#clearTimer !== null) {
      clearTimeout(this.#clearTimer);
      this.#clearTimer = null;
    }
    if (this.#element?.parentNode) {
      this.#element.parentNode.removeChild(this.#element);
    }
  }

  #say(message: string): void {
    if (!this.#element) return;
    this.#element.textContent = message;
    if (this.#clearTimer !== null) clearTimeout(this.#clearTimer);
    this.#clearTimer = setTimeout(() => {
      this.#clearTimer = null;
      if (this.#element) this.#element.textContent = '';
    }, CLEAR_DELAY_MS);
  }
}
