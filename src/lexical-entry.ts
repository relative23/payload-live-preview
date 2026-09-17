/**
 * `payload-live-preview/lexical`: the Lexical renderer and its registries on
 * their own, for server rendering and a shared `renderRichText`. The renderer
 * sanitizes through a DOM; on a server that is the document handed to
 * `setSanitizerDocument()`, from this entry or any other.
 */

export * from './lexical';
export { setSanitizerDocument, type SanitizerDocument } from './security/sanitizer';
export type { NodeRenderer, RenderNodeContext } from './lexical/registry';
