/** Public Lexical surface: the renderer plus the node and block registries. */

export {
  isLexicalContent,
  lexicalToHtml,
  lexicalToPlainText,
  type LexicalRenderOptions,
} from './render';
export { register as registerLexicalNode } from './registry';
export {
  registerBlockRenderer,
  type BlockRenderer,
  type BlockRenderContext,
} from './blocks/registry';
export { registerDefaultBlocks } from './blocks/defaults';
export type { LexicalNode, LexicalRoot } from './types';
