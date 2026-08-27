/**
 * `payload-live-preview/lexical` — the Lexical renderer on its own.
 *
 * `lexicalToHtml()` and `lexicalToPlainText()` with the node and block
 * renderer registries, for server code that renders rich text at build or
 * request time and for a project rich-text renderer shared with the client
 * (`renderRichText`). Nothing here touches the DOM.
 *
 * @module payload-live-preview/lexical
 */

export * from './lexical';
export type { NodeRenderer, RenderNodeContext } from './lexical/registry';
