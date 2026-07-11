/**
 * Public Lexical node types.
 *
 * Mirrors the shape Payload's Lexical serializer emits in
 * `fields.<richTextField>` payloads. We only require the discriminator
 * `type` field and the optional `children` array — every other
 * property is opaque and forwarded as-is to the renderer that handles
 * the node type.
 *
 * @module @lexical/types
 */

/**
 * Bitmask of Lexical text-format flags.
 *
 * Multiple flags can be combined: `BOLD | ITALIC = 3`.
 */
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

/**
 * Generic Lexical node. Concrete renderers consume specific subtypes
 * through narrow type guards in their own modules.
 */
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

/**
 * Root of a Lexical document.
 */
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
