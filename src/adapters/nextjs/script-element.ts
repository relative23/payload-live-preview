/**
 * What a Next `<script>` element carries for the runtime, shared by the
 * synchronous `livePreviewScriptProps()` and the `LivePreviewScript` component.
 * It lives apart so the component builds the same props without the helper's
 * deprecation notice: the component renders them only for an authorized
 * request, the helper for everyone who renders the layout.
 */

import { renderScriptBody } from '@adapters/shared/response';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import type { PageFacts } from '@adapters/shared/policy-options';
import { NAVIGATION_COMMIT_EVENT } from '@core/navigation-lifecycle';
import { assertNonce } from '@inline/generator';

/**
 * A Next page is a React tree, so every script this adapter emits declares
 * that React hydrates it (ADR 0015): the runtime then holds its first write
 * until React has committed the tree that holds the bindings, instead of
 * writing into markup React is about to compare with its own render. Knowledge
 * the adapter has, not an option a project sets.
 */
export const REACT_PAGE: PageFacts = {
  hydration: 'react',
  softNavigationEvents: [NAVIGATION_COMMIT_EVENT],
};

/** What a `<script>` element needs to carry the runtime; see `livePreviewScriptProps`. */
export interface LivePreviewScriptProps {
  readonly dangerouslySetInnerHTML: { readonly __html: string };
  /** Present only when a nonce was passed, so React omits the attribute otherwise. */
  readonly nonce?: string;
}

/**
 * The nonce stays a prop rather than going into the body, because that is where
 * the framework — and any CSP handling built on it — expects the attribute.
 */
export function scriptElementProps(
  options: PreviewAdapterOptions & { readonly nonce?: string },
): LivePreviewScriptProps {
  const html = renderScriptBody(options, REACT_PAGE);
  if (options.nonce === undefined) return { dangerouslySetInnerHTML: { __html: html } };
  return {
    dangerouslySetInnerHTML: { __html: html },
    nonce: assertNonce(options.nonce),
  };
}
