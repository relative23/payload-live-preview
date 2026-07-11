/**
 * Shared utilities for Lexical node renderers.
 *
 * @module @lexical/utils
 */

import type { LexicalNode } from './types';

const ALIGNMENT_NUMERIC: Readonly<Record<number, string>> = {
  1: 'left',
  2: 'center',
  3: 'right',
  4: 'justify',
};

const ALIGNMENT_STRING = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);

/**
 * Resolve the `text-align` value for a block-level Lexical node.
 *
 * Payload's Lexical serializer historically emits both string formats
 * (`'left'`) and a numeric bitmask in `format`. We honour both forms.
 */
export function resolveAlignment(node: LexicalNode): string | undefined {
  const fmt = node.format;
  if (typeof fmt === 'string' && ALIGNMENT_STRING.has(fmt)) return fmt;
  if (typeof fmt === 'number') {
    const mapped = ALIGNMENT_NUMERIC[fmt];
    if (mapped !== undefined) return mapped;
  }
  return undefined;
}

/**
 * Resolve the indent depth for a node. Defaults to `0`.
 */
export function resolveIndent(node: LexicalNode): number {
  const indent = node.indent;
  return typeof indent === 'number' && indent > 0 ? indent : 0;
}

/**
 * Build the `dir="..."` attribute for a node when a direction is set.
 */
export function dirAttribute(node: LexicalNode): string {
  if (node.direction === 'rtl') return ' dir="rtl"';
  if (node.direction === 'ltr') return ' dir="ltr"';
  return '';
}

/**
 * Build a `style` attribute combining `text-align` and `padding-inline-start`
 * (the standard way Lexical maps indent to CSS).
 */
export function styleAttribute(node: LexicalNode): string {
  const align = resolveAlignment(node);
  const indent = resolveIndent(node);
  const styles: string[] = [];
  if (align !== undefined) styles.push(`text-align:${align}`);
  if (indent > 0) styles.push(`padding-inline-start:${String(indent * 40)}px`);
  if (styles.length === 0) return '';
  return ` style="${styles.join(';')}"`;
}
