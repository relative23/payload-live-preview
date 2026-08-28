/**
 * Reveal the bound element for the field being edited, so the preview always
 * shows the section under the editor's cursor without the user scrolling to
 * find it (roadmap 2.0 "reveal the edited section"). Two callers share this:
 * the lifecycle reveals the field whose value just changed (typing), and the
 * message bus reveals a field the admin reports the cursor moved into.
 *
 * The logic is deliberately conservative — it only scrolls when the target is
 * off-screen and only when the edited field actually changed since the last
 * reveal, so continuous typing in one field never re-scrolls and a deliberate
 * manual scroll-away is not fought. It honours `prefers-reduced-motion`.
 *
 * Pure and DOM-injected (element + window passed in) so it unit-tests without
 * a live browser.
 *
 * @module @core/reveal
 */

/** The slice of `Window` this module reads — kept minimal for testability. */
export interface RevealWindow {
  readonly innerHeight: number;
  readonly innerWidth: number;
  matchMedia?: (query: string) => { readonly matches: boolean };
}

/** The slice of `Element` this module needs. */
export interface RevealElement {
  getBoundingClientRect: () => {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
  scrollIntoView: (options?: {
    behavior?: 'auto' | 'smooth';
    block?: 'center' | 'nearest' | 'start';
  }) => void;
}

/** Whether the viewer asked for reduced motion; smooth scrolling is suppressed when so. */
export function prefersReducedMotion(win: RevealWindow): boolean {
  try {
    return win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/**
 * Whether `element` is at least partially within the viewport. A fully
 * off-screen element (above, below, or beside) returns false; anything with a
 * visible sliver returns true, so we never scroll an element the user can
 * already see.
 */
export function isInViewport(element: RevealElement, win: RevealWindow): boolean {
  const rect = element.getBoundingClientRect();
  const vertically = rect.bottom > 0 && rect.top < win.innerHeight;
  const horizontally = rect.right > 0 && rect.left < win.innerWidth;
  return vertically && horizontally;
}

/** Outcome of a reveal attempt, for the caller's diagnostics/telemetry. */
export type RevealOutcome = 'revealed' | 'already-visible';

/** Scroll `element` into view only when it is off-screen. */
export function revealElement(element: RevealElement, win: RevealWindow): RevealOutcome {
  if (isInViewport(element, win)) return 'already-visible';
  element.scrollIntoView({
    behavior: prefersReducedMotion(win) ? 'auto' : 'smooth',
    block: 'center',
  });
  return 'revealed';
}

/**
 * Tracks the last field revealed so the same field is not scrolled to on every
 * keystroke — a reveal fires only when the edited field *changes*. That is what
 * keeps it from fighting a manual scroll: typing on in one field, or scrolling
 * away while editing it, never re-centres; moving to a different field does.
 */
export class FieldRevealer {
  #lastField: string | undefined;

  /**
   * Reveal `element` for `fieldName` unless it is the field already revealed.
   * Returns what happened: `skipped-same` when the field is unchanged since the
   * last reveal, otherwise the underlying viewport outcome.
   */
  reveal(
    fieldName: string,
    element: RevealElement,
    win: RevealWindow,
  ): RevealOutcome | 'skipped-same' {
    if (fieldName === this.#lastField) return 'skipped-same';
    this.#lastField = fieldName;
    return revealElement(element, win);
  }

  /** Forget the last field — e.g. after a navigation that rebuilt the page. */
  reset(): void {
    this.#lastField = undefined;
  }
}
