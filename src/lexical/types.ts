/**
 * Lexical document types. Only `type` and `children` are required; every
 * other property is forwarded opaquely to the renderer for that node type.
 */

/** Lexical text-format bitmask; flags combine (`BOLD | ITALIC === 3`). */
export const TextFormat = {
  BOLD: 1,
  ITALIC: 2,
  STRIKETHROUGH: 4,
  UNDERLINE: 8,
  CODE: 16,
  SUBSCRIPT: 32,
  SUPERSCRIPT: 64,
  HIGHLIGHT: 128,
} as const;

export interface LexicalNode {
  readonly type: string;
  readonly version?: number;
  readonly format?: number | string;
  readonly indent?: number;
  readonly direction?: 'ltr' | 'rtl' | null;
  readonly children?: readonly LexicalNode[];
  readonly text?: string;
  readonly [extra: string]: unknown;
}

export interface LexicalRoot {
  readonly root: {
    readonly type?: string;
    readonly children: readonly LexicalNode[];
    readonly direction?: 'ltr' | 'rtl' | null;
    readonly format?: number | string;
    readonly indent?: number;
    readonly [extra: string]: unknown;
  };
}
