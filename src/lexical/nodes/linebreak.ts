/**
 * Renderers for `linebreak`, `horizontalrule`, and `tab` Lexical nodes.
 *
 * @module @lexical/nodes/linebreak
 */

import { register, type NodeRenderer } from '../registry';

const linebreakRenderer: NodeRenderer = () => '<br>';
const horizontalRuleRenderer: NodeRenderer = () => '<hr>';
const tabRenderer: NodeRenderer = () => '\t';

register('linebreak', linebreakRenderer);
register('horizontalrule', horizontalRuleRenderer);
register('tab', tabRenderer);

export { linebreakRenderer, horizontalRuleRenderer, tabRenderer };
