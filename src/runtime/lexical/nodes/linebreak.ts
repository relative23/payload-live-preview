import type { NodeRenderer } from '../registry';

const linebreakRenderer: NodeRenderer = () => '<br>';
const horizontalRuleRenderer: NodeRenderer = () => '<hr>';
const tabRenderer: NodeRenderer = () => '\t';

export { linebreakRenderer, horizontalRuleRenderer, tabRenderer };
