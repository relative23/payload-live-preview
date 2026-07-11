/**
 * Lexical node-renderer registry.
 *
 * Each Payload Lexical node type maps to one renderer module under
 * `./nodes/`. The registry pattern keeps each node's logic in its own
 * file (clean separation of concerns) and lets consumers register
 * custom renderers via the plugin system without touching this module.
 *
 * @module @lexical/registry
 */

import type { LexicalNode } from './types';

/**
 * Context passed to node renderers. Includes the recursive renderer
 * for children and the `alignment` resolver so block-level nodes can
 * apply paragraph/heading alignment uniformly.
 */
export interface RenderNodeContext {
  /**
   * Render an arbitrary list of children. Handles whitespace, falls
   * through to text renderers, and honours the registry. Renderers
   * call this to render their own descendants.
   */
  readonly renderChildren: (children: readonly LexicalNode[]) => string;
  /**
   * Resolve the textual alignment for a block-level node. Returns
   * `undefined` when no alignment is specified.
   */
  readonly resolveAlignment: (node: LexicalNode) => string | undefined;
  /**
   * Resolve the indent count for a node. Used to build inline indent
   * styles for paragraphs and list items.
   */
  readonly resolveIndent: (node: LexicalNode) => number;
}

/** Renderer signature: `(node, ctx) => htmlString`. */
export type NodeRenderer = (node: LexicalNode, context: RenderNodeContext) => string;

/**
 * Mutable registry. Built-in node renderers populate the map at
 * import time; consumer code may extend it via `register`.
 */
const registry = new Map<string, NodeRenderer>();

/**
 * Register or replace the renderer for `type`.
 */
export function register(type: string, renderer: NodeRenderer): void {
  registry.set(type, renderer);
}

/** Look up the renderer for `type`, or `undefined`. */
export function lookup(type: string): NodeRenderer | undefined {
  return registry.get(type);
}

/** Snapshot of registered node types. Useful for diagnostics. */
export function registeredTypes(): readonly string[] {
  return [...registry.keys()];
}

/** Test-only helper: clear the registry. */
export function __resetForTests(): void {
  registry.clear();
}
