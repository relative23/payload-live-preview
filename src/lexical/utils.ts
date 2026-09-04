/** Attribute helpers shared by the block-level node renderers. */

import type { LexicalNode } from './types';

const ALIGNMENT_NUMERIC: Readonly<Record<number, string>> = {
  1: 'left',
  2: 'center',
  3: 'right',
  4: 'justify',
};

const ALIGNMENT_STRING = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);

/** Alignment of a block node; Payload emits it as a string or as Lexical's numeric format. */
export function resolveAlignment(node: LexicalNode): string | undefined {
  const fmt = node.format;
  if (typeof fmt === 'string' && ALIGNMENT_STRING.has(fmt)) return fmt;
  if (typeof fmt === 'number') return ALIGNMENT_NUMERIC[fmt];
  return undefined;
}

export function resolveIndent(node: LexicalNode): number {
  const indent = node.indent;
  return typeof indent === 'number' && indent > 0 ? indent : 0;
}

export function dirAttribute(node: LexicalNode): string {
  if (node.direction === 'rtl') return ' dir="rtl"';
  if (node.direction === 'ltr') return ' dir="ltr"';
  return '';
}

/**
 * Alignment and indent as `lp-align-*` / `lp-indent-N` classes. The sanitizer
 * strips `style` under every policy, so inline CSS would never reach the page.
 */
export function layoutClassAttribute(node: LexicalNode): string {
  const align = resolveAlignment(node);
  const indent = resolveIndent(node);
  const classes: string[] = [];
  if (align !== undefined) classes.push(`lp-align-${align}`);
  if (indent > 0) classes.push(`lp-indent-${String(indent)}`);
  return classes.length === 0 ? '' : ` class="${classes.join(' ')}"`;
}
