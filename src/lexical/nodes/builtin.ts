import type { NodeRenderer } from '../registry';
import { textRenderer } from './text';
import { paragraphRenderer } from './paragraph';
import { headingRenderer } from './heading';
import { listRenderer, listItemRenderer } from './list';
import { linkRenderer } from './link';
import { quoteRenderer } from './quote';
import { codeRenderer, codeHighlightRenderer } from './code';
import { linebreakRenderer, horizontalRuleRenderer, tabRenderer } from './linebreak';
import { uploadRenderer } from './upload';
import { relationshipRenderer } from './relationship';
import { blockRenderer } from './block';

/**
 * The built-in node renderers, as a plain table rather than `register()`
 * calls at import time. A table is pure for a bundler: a consumer that never
 * renders Lexical content does not carry these renderers, and one that does
 * finds every built-in type resolvable through `lookup()` before any render.
 */
export const BUILTIN_NODE_RENDERERS: Readonly<Record<string, NodeRenderer>> = {
  text: textRenderer,
  paragraph: paragraphRenderer,
  heading: headingRenderer,
  list: listRenderer,
  listitem: listItemRenderer,
  link: linkRenderer,
  autolink: linkRenderer,
  quote: quoteRenderer,
  code: codeRenderer,
  'code-highlight': codeHighlightRenderer,
  linebreak: linebreakRenderer,
  horizontalrule: horizontalRuleRenderer,
  tab: tabRenderer,
  upload: uploadRenderer,
  relationship: relationshipRenderer,
  block: blockRenderer,
};
