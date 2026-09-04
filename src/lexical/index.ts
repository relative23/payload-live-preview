/** Public Lexical surface: the renderer plus the node and block registries. */

export {
  isLexicalContent,
  lexicalToHtml,
  lexicalToPlainText,
  type LexicalRenderOptions,
} from './render';
export { register as registerLexicalNode, lookup as lookupLexicalNode } from './registry';
export {
  registerBlockRenderer,
  lookupBlockRenderer,
  registeredBlockTypes,
  type BlockRenderer,
  type BlockRenderContext,
} from './blocks/registry';
export { registerDefaultBlocks } from './blocks/defaults';
export type { LexicalNode, LexicalRoot } from './types';
export { TextFormat } from './types';
