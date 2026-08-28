/** `table` / `tablerow` / `tablecell` renderers for the `@lexical/table` shapes Payload's table feature emits. */

import type { NodeRenderer } from '../registry';
import { dirAttribute } from '../utils';

// `@lexical/table` TableCellHeaderStates: ROW marks a cell in a header row, COLUMN one in a header column.
const HEADER_ROW = 1;
const HEADER_COLUMN = 2;

const tableRenderer: NodeRenderer = (node, ctx) =>
  `<table${dirAttribute(node)}><tbody>${ctx.renderChildren(node.children ?? [])}</tbody></table>`;

const tableRowRenderer: NodeRenderer = (node, ctx) =>
  `<tr>${ctx.renderChildren(node.children ?? [])}</tr>`;

const tableCellRenderer: NodeRenderer = (node, ctx): string => {
  const header = typeof node['headerState'] === 'number' ? node['headerState'] : 0;
  const tag = (header & (HEADER_ROW | HEADER_COLUMN)) === 0 ? 'td' : 'th';
  const scope =
    header === HEADER_ROW ? ' scope="col"' : header === HEADER_COLUMN ? ' scope="row"' : '';
  return `<${tag}${scope}${spanAttribute('colspan', node['colSpan'])}${spanAttribute('rowspan', node['rowSpan'])}>${ctx.renderChildren(node.children ?? [])}</${tag}>`;
};

function spanAttribute(name: string, value: unknown): string {
  return typeof value === 'number' && value > 1 ? ` ${name}="${String(value)}"` : '';
}

export { tableRenderer, tableRowRenderer, tableCellRenderer };
