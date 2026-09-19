/**
 * `payload-live-preview/lexical`: the Lexical renderer and its registries on
 * their own, for server rendering and a shared `renderRichText`. The renderer
 * sanitizes through a DOM; on a server that is the document handed to
 * `setSanitizerDocument()`, from this entry or any other.
 */

export * from './lexical';
// eslint-disable-next-line @typescript-eslint/no-deprecated -- the fallback slot exists to be re-exported until 3.0
export { setSanitizerDocument, type SanitizerDocument } from './security/sanitizer';
export type { NodeRenderer, RenderNodeContext } from './lexical/registry';
