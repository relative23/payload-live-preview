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
import { blockRenderer, inlineBlockRenderer } from './block';
import { tableCellRenderer, tableRenderer, tableRowRenderer } from './table';

// A value table instead of `register()` calls at import time: a consumer that
// never renders Lexical content must not carry these under `sideEffects: false`.
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
  inlineBlock: inlineBlockRenderer,
  table: tableRenderer,
  tablerow: tableRowRenderer,
  tablecell: tableCellRenderer,
};
