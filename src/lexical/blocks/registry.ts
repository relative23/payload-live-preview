/**
 * Block-renderer sub-registry.
 *
 * Payload's BlocksFeature emits Lexical `block` nodes with a
 * `blockType` slug. The default `block`-node renderer (in
 * `../nodes/block.ts`) only emits a generic
 * `<div data-block-type="…">` — useful as a hook, but unhelpful when
 * the consumer wants out-of-the-box rendering for common block types.
 *
 * This registry maps `blockType` → renderer. Default renderers ship
 * for the most common Payload block patterns (callout, image,
 * video, code, cta). Custom slugs override defaults via
 * `registerBlockRenderer(slug, renderer)`.
 *
 * @module @lexical/blocks/registry
 */

import type { LexicalNode } from '../types';

/**
 * Context passed to a block renderer. Includes the recursive
 * `renderChildren` function so blocks that house nested Lexical
 * content can delegate back to the main renderer.
 */
export interface BlockRenderContext {
  /** Renders a list of Lexical children to HTML. */
  readonly renderChildren: (children: readonly LexicalNode[]) => string;
}

/**
 * Renderer signature. Receives the block node *and* its already-read
 * `fields` payload (the parser pulls these out so individual block
 * renderers don't have to reach into `node['fields']` themselves).
 */
export type BlockRenderer = (
  fields: Record<string, unknown>,
  context: BlockRenderContext,
) => string;

const registry = new Map<string, BlockRenderer>();

/** Register or replace the renderer for `blockType`. */
export function registerBlockRenderer(blockType: string, renderer: BlockRenderer): void {
  registry.set(blockType, renderer);
}

/** Look up the renderer for `blockType`, or `undefined`. */
export function lookupBlockRenderer(blockType: string): BlockRenderer | undefined {
  return registry.get(blockType);
}

/** Snapshot of registered block types — useful for diagnostics. */
export function registeredBlockTypes(): readonly string[] {
  return [...registry.keys()];
}

/** Test-only: clear the registry. */
export function __resetBlockRegistryForTests(): void {
  registry.clear();
}
