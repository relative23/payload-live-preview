/** Node-renderer registry: consumer registrations layered over the built-in table. */

import type { LexicalNode } from './types';
import { BUILTIN_NODE_RENDERERS } from './nodes/builtin';

export interface RenderNodeContext {
  /** Render child nodes through the registry. */
  readonly renderChildren: (children: readonly LexicalNode[]) => string;
  /** Text alignment of a block node, or `undefined`. */
  readonly resolveAlignment: (node: LexicalNode) => string | undefined;
  /** Indent level of a node, `0` when none. */
  readonly resolveIndent: (node: LexicalNode) => number;
  /**
   * Where a `block` or `inlineBlock` without a renderer is reported, with the
   * slug Payload sent and the class of the placeholder written in its place.
   * `undefined` on a plain `lexicalToHtml()` call; the `richText` write sets it.
   */
  readonly onUnrenderedBlock?: ((blockType: string, placeholderClass: string) => void) | undefined;
}

export type NodeRenderer = (node: LexicalNode, context: RenderNodeContext) => string;

const registry = new Map<string, NodeRenderer>();

/** Register or replace the renderer for `type`. */
export function register(type: string, renderer: NodeRenderer): void {
  registry.set(type, renderer);
}

/** @internal */
export function lookup(type: string): NodeRenderer | undefined {
  return registry.get(type) ?? BUILTIN_NODE_RENDERERS[type];
}

export function registeredTypes(): readonly string[] {
  return [...new Set([...Object.keys(BUILTIN_NODE_RENDERERS), ...registry.keys()])];
}

/** Test-only: drop consumer registrations. */
export function __resetForTests(): void {
  registry.clear();
}
