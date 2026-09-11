/**
 * Every place this package turns a string into markup or writes an attribute
 * whose value could carry a URL or a style, and why each one is safe.
 *
 * Nothing in the type system says so — `trustedHtml()` takes a string, and
 * the Trusted Types policy behind it is an identity policy, because a
 * sanitizer cannot re-verify from inside what it already guaranteed. Static
 * analysers read that shape as a DOM-XSS sink and are right to: the guarantee
 * lives in the call sites, not in the signature. So the call sites are the
 * thing to hold still. A new sink, or a change to what an existing one is
 * fed, fails the architecture gate until someone writes down which
 * justification applies. That is the review this file exists to force; it is
 * not a proof that the reasons are true.
 *
 * Keys are `<module>::<expression>` — for an HTML sink the expression fed in,
 * for an attribute sink the whole write — as `scripts/architecture-capabilities.ts`
 * reads them off the syntax.
 */

/**
 * `inert-parse`    — into a `<template>`, whose content is never activated:
 *                    no script runs, no resource loads.
 * `sanitised`      — the sanitizer produced it.
 * `escaped`        — built from escape helpers, which cannot emit markup.
 * `trusted-origin` — the project's own same-origin server render, trusted the
 *                    way any SSR framework trusts its own output.
 */
export type HtmlSinkJustification = 'inert-parse' | 'sanitised' | 'escaped' | 'trusted-origin';

// The renderers sanitise with the instance's policy (`context.sanitizerPolicy`,
// ADR 0002); `sanitizeHtmlWithPolicy` is `sanitizeHtml` with that one extra input.
export const HTML_SINKS: ReadonlyMap<string, HtmlSinkJustification> = new Map([
  [
    'src/field-types/html.ts::trustedHtml(sanitizeHtmlWithPolicy(html, context.sanitizerPolicy))',
    'sanitised',
  ],
  // `templateOptions` is `templateSanitizeOptions(template)`: the author's item template.
  [
    'src/field-types/array.ts::trustedHtml(sanitizeHtmlWithPolicy(html, policy, templateOptions))',
    'sanitised',
  ],
  ['src/field-types/rich-text.ts::trustedHtml(sanitizeHtmlWithPolicy(html, policy))', 'sanitised'],
  ['src/field-types/rich-text.ts::trustedHtml(sanitizeHtmlWithPolicy(value, policy))', 'sanitised'],
  // `html` is `sanitizeHtmlWithPolicy(lexicalToHtml(value, { sanitize: false }),
  // policy)`: Lexical no longer sanitises on its own here, because it would do
  // so with the process default. The caller does it with the instance's policy,
  // and that is what covers a project's own `registerBlockRenderer`, whose
  // string this package never inspects. The element parsed into is a childless
  // clone of the bound one, detached until its children are moved across.
  ['src/field-types/rich-text.ts::trustedHtml(html)', 'sanitised'],
  [
    'src/field-types/upload.ts::trustedHtml(`<a href="${escapeHtmlAttribute(url)}">${label}</a>`)',
    'escaped',
  ],
  ['src/field-types/text.ts::trustedHtml(escapeAndLinebreak(text))', 'escaped'],
  // Sanitised first, then parsed inertly to be adopted — safe twice over.
  ['src/core/structural-applier.ts::trustedHtml(safe)', 'sanitised'],
  // The sanitizer's own parse. Untrusted markup by definition; it is read back
  // only after the fragment has been walked and stripped.
  ['src/security/sanitizer.ts::trustedHtml(html)', 'inert-parse'],
  // A fragment the project's server rendered, parsed here and morphed into the
  // boundary. Sanitising it would strip the page's own legitimate markup.
  ['src/core/strategy-runner.ts::trustedHtml(html)', 'trusted-origin'],
]);

/**
 * `gated`         — the core's own policed write: name checked against the
 *                   block-list, URL attributes against `isSafeUrl`.
 * `copied`        — the attribute is copied from a node this package already
 *                   checked: a sanitised item, a rendered fragment, a sibling
 *                   the page author wrote.
 * `binding-stamp` — a `data-payload-*` name this package chose, carrying a
 *                   field name or key; a data attribute executes nothing.
 * `url-validated` — the value passed `isSafeUrl` (directly, or through
 *                   `acceptUrl`, which is `isSafeUrl` plus one LP0401 warning).
 * `constant`      — the value is this package's own literal or a consumer's
 *                   own option, never a value from the wire.
 *
 * Only writes that name a URL-bearing attribute or `style`, or compute the
 * attribute's name, are listed: `role`, `aria-*`, `datetime`, `rel` and the
 * like execute nothing whatever they are set to.
 */
export type AttributeSinkJustification =
  'gated' | 'copied' | 'binding-stamp' | 'url-validated' | 'constant';

export const ATTRIBUTE_SINKS: ReadonlyMap<string, AttributeSinkJustification> = new Map([
  ['src/core/attribute-binding.ts::element.setAttribute(name, stringValue)', 'gated'],
  // The keyed morph mirrors the rendered node's attributes onto the live one;
  // the rendered node is a sanitised item or a fragment the page's own server
  // rendered (`HTML_SINKS` says which, per caller).
  ['src/core/morph.ts::live.setAttribute(attribute.name, attribute.value)', 'copied'],
  [
    'src/core/structural-applier.ts::target.setAttribute(attribute.name, attribute.value)',
    'copied',
  ],
  // What every existing item of the list already carried, filtered through
  // `isWritableAttribute` before it is inherited by a rebuilt one.
  ['src/core/array-template.ts::item.setAttribute(name, value)', 'copied'],
  // `<meta>`/`<link>` attributes from the fresh route document, which the
  // page's own server rendered.
  ['src/fragment/route.ts::current.setAttribute(attribute.name, attribute.value)', 'copied'],
  ['src/core/structural-applier.ts::first.setAttribute(KEY_ATTRIBUTE, key)', 'binding-stamp'],
  // The auto-binding search stamps the `data-payload-*` names it derived and
  // the field it matched (ADR 0014).
  ['src/core/auto-bind.ts::element.setAttribute(name, value)', 'binding-stamp'],
  [
    'src/core/auto-bind.ts::element.setAttribute(GUESSED_ATTRIBUTE, candidate.matched)',
    'binding-stamp',
  ],
  ["src/field-types/url.ts::element.setAttribute('href', outcome.url)", 'url-validated'],
  ["src/field-types/relationship.ts::element.setAttribute('href', outcome.url)", 'url-validated'],
  ["src/field-types/upload.ts::element.setAttribute('href', url)", 'url-validated'],
  // Both callers (`image.ts`, `upload.ts`) hand over `outcome.url` from
  // `acceptUrl`; every `srcset` candidate is checked here again.
  ['src/field-types/media.ts::img.src = url', 'url-validated'],
  ["src/field-types/media.ts::img.setAttribute('srcset', srcset)", 'url-validated'],
  // `escapeCssUrl` stops the break-out from `url(...)`; `acceptUrl` before it
  // stopped the scheme.
  [
    "src/field-types/image.ts::(element as HTMLElement).style.backgroundImage = `url('${escapeCssUrl(outcome.url)}')`",
    'url-validated',
  ],
  ["src/field-types/image.ts::(element as HTMLElement).style.backgroundImage = ''", 'constant'],
  // The bootstrap's URL and integrity are baked in by the generator at build time.
  ['src/core/loader.ts::script.src = __LP_RUNTIME_SRC__', 'constant'],
  // Development furniture: the live region and the unbound-fields overlay,
  // styled from this package's own constants; `position` is the plugin's own
  // option, and a consumer's CSS on a consumer's page is not a wire value.
  ["src/core/a11y.ts::element.setAttribute('style', STYLE)", 'constant'],
  [
    "src/plugins/built-in/unbound-fields-overlay.ts::field.setAttribute('style', 'position:fixed;opacity:0;pointer-events:none;')",
    'constant',
  ],
  [
    "src/plugins/built-in/unbound-fields-overlay.ts::button.setAttribute('style', BUTTON_STYLE)",
    'constant',
  ],
  [
    "src/plugins/built-in/unbound-fields-overlay.ts::panel.setAttribute('style', PANEL_STYLE + position)",
    'constant',
  ],
  [
    "src/plugins/built-in/unbound-fields-overlay.ts::title.setAttribute('style', 'font-weight:600;margin-bottom:4px;')",
    'constant',
  ],
]);

export function sinkKey(module: string, site: string): string {
  return `${module}::${site}`;
}
