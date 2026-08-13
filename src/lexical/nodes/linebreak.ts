/**
 * Renderers for `linebreak`, `horizontalrule`, and `tab` Lexical nodes.
 *
 * @module @lexical/nodes/linebreak
 */

import type { NodeRenderer } from '../registry';

const linebreakRenderer: NodeRenderer = () => '<br>';
const horizontalRuleRenderer: NodeRenderer = () => '<hr>';
const tabRenderer: NodeRenderer = () => '\t';

export { linebreakRenderer, horizontalRuleRenderer, tabRenderer };
