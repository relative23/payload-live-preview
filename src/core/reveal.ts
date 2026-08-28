/**
 * Scroll the edited field's bound element into view. Deliberately quiet: only
 * when the target is off-screen and only when the edited field changed since
 * the last reveal, so continuous typing never re-scrolls and a deliberate
 * scroll-away is not fought. Honours `prefers-reduced-motion`.
 */

/** The slice of `Window` this reads, so it tests without a browser. */
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

/** A visible sliver counts: an element the editor can already see is never scrolled to. */
export function isInViewport(element: RevealElement, win: RevealWindow): boolean {
  const rect = element.getBoundingClientRect();
  const vertically = rect.bottom > 0 && rect.top < win.innerHeight;
  const horizontally = rect.right > 0 && rect.left < win.innerWidth;
  return vertically && horizontally;
}

/** Outcome of a reveal attempt, for the caller's diagnostics. */
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

/** Remembers the last field revealed, so only a change of field scrolls again. */
export class FieldRevealer {
  #lastField: string | undefined;

  /** `skipped-same` when this is still the field last revealed. */
  reveal(
    fieldName: string,
    element: RevealElement,
    win: RevealWindow,
  ): RevealOutcome | 'skipped-same' {
    if (fieldName === this.#lastField) return 'skipped-same';
    this.#lastField = fieldName;
    return revealElement(element, win);
  }

  /** Forget the last field, after a navigation that rebuilt the page. */
  reset(): void {
    this.#lastField = undefined;
  }
}
