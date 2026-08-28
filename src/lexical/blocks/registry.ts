/** Block-renderer registry keyed by Payload block slug; consulted by the `block` and `inlineBlock` nodes. */

import type { LexicalNode } from '../types';

export interface BlockRenderContext {
  /** Render nested Lexical content through the node registry. */
  readonly renderChildren: (children: readonly LexicalNode[]) => string;
}

/** Receives the block's `fields` (with `blockType`) and returns HTML. */
export type BlockRenderer = (
  fields: Record<string, unknown>,
  context: BlockRenderContext,
) => string;

const registry = new Map<string, BlockRenderer>();

/** Register or replace the renderer for `blockType`. */
export function registerBlockRenderer(blockType: string, renderer: BlockRenderer): void {
  registry.set(blockType, renderer);
}

export function lookupBlockRenderer(blockType: string): BlockRenderer | undefined {
  return registry.get(blockType);
}

export function registeredBlockTypes(): readonly string[] {
  return [...registry.keys()];
}

/** Test-only: clear the registry. */
export function __resetBlockRegistryForTests(): void {
  registry.clear();
}
