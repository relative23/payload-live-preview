/**
 * Writes one scheduled value into its bound element: renderer resolution,
 * the attribute or renderer write, and the `elementUpdate` event. Every
 * consumer callback may accept a newer revision synchronously, so the
 * transaction is re-checked after each one (ADR 0004).
 */

import { lookupSchema, payloadTypeToRenderer } from '@schema/index';
import { applyAttributeBinding } from './attribute-binding';
import { rendererUsesNoWriteOutcome } from './internal-outcome';
import {
  sameRevision,
  type RuntimeDeps,
  type RuntimeState,
  type UpdateTransaction,
} from './runtime-state';
import type { CachedElement, FieldRenderer, RenderContext, RendererKey } from './types';
import type { ScheduledUpdate } from './update-scheduler';

export class BindingWriter {
  constructor(
    private readonly deps: RuntimeDeps,
    private readonly state: RuntimeState,
  ) {}

  /** Scheduler callback. `false` means nothing reached the DOM. */
  apply(update: ScheduledUpdate): boolean {
    const { deps, state } = this;
    const transaction = state.activeUpdate;
    if (
      transaction === null ||
      update.identity === undefined ||
      !sameRevision(transaction.identity, update.identity) ||
      !state.isCurrent(transaction)
    ) {
      return false;
    }
    const { target, value } = update;
    const schemaEntry =
      transaction.schemaIndex !== undefined
        ? lookupSchema(transaction.schemaIndex, target.fieldName)
        : undefined;
    let type = resolveFieldType(target, schemaEntry?.type);
    // Payload 3.x sends no schema; a Lexical root is unmistakable.
    if (type === 'text' && target.explicitFieldType !== true && looksLikeLexicalRoot(value)) {
      type = 'richText';
    }
    let renderer: FieldRenderer | undefined;
    try {
      renderer = deps.resolveRenderer(type, target);
    } catch (error) {
      return this.fail(transaction, error);
    }
    if (!state.isCurrent(transaction)) return false;
    const emitElementUpdate = deps.emitter.listenerCount('elementUpdate') > 0;
    // Custom-element accessors run application code, so this is a boundary too.
    const previous = emitElementUpdate ? readElementSnapshot(target.element) : undefined;
    if (!state.isCurrent(transaction)) return false;
    const context: RenderContext = {
      allFields: update.allFields,
      locale: target.locale ?? transaction.locale,
      schema: schemaEntry,
      ...(deps.renderRichText !== undefined ? { renderRichText: deps.renderRichText } : {}),
    };
    // A boundary anchor stays out of layout and the accessibility tree while empty.
    if (target.boundary === true) {
      target.element.toggleAttribute('hidden', isEmptyFieldValue(value));
    }
    try {
      if (target.targetAttribute !== undefined) {
        if (applyAttributeBinding(target.element, target.targetAttribute, value) === 'blocked') {
          deps.warn(
            `[live-preview] LP0401: refused to write "${target.fieldName}" into attribute "${target.targetAttribute}"`,
          );
          return false;
        }
      } else if (renderer !== undefined) {
        const outcome = invokeRenderer(renderer, target, value, context);
        if (outcome === false && rendererUsesNoWriteOutcome(renderer)) return false;
      } else {
        deps.log('no renderer for', type);
        return false;
      }
    } catch (error) {
      return this.fail(transaction, error);
    }
    if (!state.isCurrent(transaction)) return false;
    if (emitElementUpdate) {
      void deps.emitter.emitWhile(
        'elementUpdate',
        {
          element: target.element,
          fieldName: target.fieldName,
          previousValue: previous,
          nextValue: value,
          revision: transaction.identity.revision,
          receivedAt: transaction.receivedAt,
          source: 'patch',
        },
        () => state.isCurrent(transaction),
      );
    }
    // The first handler runs before emitWhile yields; a reentrant newer
    // revision must not count this write as applied.
    const applied = state.isCurrent(transaction);
    if (applied) {
      if (update.valueIdentity !== undefined) {
        state.lastAppliedIdentity.set(target.element, update.valueIdentity);
      } else {
        state.lastAppliedIdentity.delete(target.element);
      }
    }
    return applied;
  }

  private fail(transaction: UpdateTransaction, cause: unknown): false {
    if (!this.state.isCurrent(transaction)) return false;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    void this.deps.emitter.emitWhile('error', { error, context: 'renderer', code: 'LP0603' }, () =>
      this.state.isCurrent(transaction),
    );
    return false;
  }
}

/** Explicit `data-payload-type` wins over the schema, which wins over tag heuristics. */
function resolveFieldType(target: CachedElement, schemaType: string | undefined): RendererKey {
  if (target.explicitFieldType) return target.fieldType;
  if (schemaType !== undefined) {
    const mapped = payloadTypeToRenderer(schemaType);
    if (mapped !== undefined) return mapped;
  }
  return target.fieldType;
}

/** Built-in renderers may return exact `false` for a deliberate no-write; the public type stays `void`. */
function invokeRenderer(
  renderer: FieldRenderer,
  target: CachedElement,
  value: unknown,
  context: RenderContext,
): unknown {
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
  return renderer.render(target, value, context);
}

/** Same shape test as `isLexicalContent`, duplicated so core does not pull the Lexical renderer. */
function looksLikeLexicalRoot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('root' in value)) return false;
  const root = value.root;
  return (
    typeof root === 'object' &&
    root !== null &&
    Array.isArray((root as { children?: unknown }).children)
  );
}

function readElementSnapshot(element: Element): unknown {
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    return (element as HTMLInputElement).value;
  }
  if (element.tagName === 'IMG') return (element as HTMLImageElement).src;
  return element.textContent;
}

function isEmptyFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return Array.isArray(value) && value.length === 0;
}
