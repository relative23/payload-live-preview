/** URL acceptance shared by the renderers that write `href` / `src`: one LP0401 warning per element. */

import { safeConsoleWarn } from '@core/diagnostics';
import { resolveMediaUrl } from '@lexical/value-shapes';
import { isSafeUrl } from '@security/url-validator';

// Keyed by element so a second client on the same page does not repeat the warning.
const warned = new WeakSet<Element>();

export type UrlOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'unsafe' }
  | { readonly kind: 'safe'; readonly url: string };

/**
 * `none` when there is no URL to write, `unsafe` (warned once) when it fails `isSafeUrl`.
 * `serverURL` is passed for a URL out of a media document only: a path in it is Payload's
 * (`resolveMediaUrl`), while one an author typed into a text field is the site's own.
 */
export function acceptUrl(
  element: Element,
  fieldName: string,
  candidate: unknown,
  serverURL?: string,
): UrlOutcome {
  if (typeof candidate !== 'string' || candidate.length === 0) return { kind: 'none' };
  const url = resolveMediaUrl(candidate, serverURL);
  if (isSafeUrl(url)) return { kind: 'safe', url };
  if (!warned.has(element)) {
    warned.add(element);
    safeConsoleWarn(
      `[live-preview] LP0401: refused an unsafe URL for "${fieldName}" on ` +
        `<${element.tagName.toLowerCase()}>; the attribute was cleared.`,
    );
  }
  return { kind: 'unsafe' };
}
