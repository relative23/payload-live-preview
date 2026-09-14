/**
 * Whether an accepted message has to be resolved against the server before the
 * page can render it, and how many round trips a burst of them may cost. The
 * merge exists to populate relationships and uploads, so a page that renders
 * none of them needs no request at all, a message that moved no populated field
 * is answered from its own values over what the last merge resolved, and what
 * is left goes out once at the start of a burst and once at its end.
 *
 * Conservative in one direction on purpose: a request left out that was needed
 * puts an id where a name belongs and leaves it there, while one request too
 * many costs a round trip nobody sees.
 */

import { lookupSchema, type SchemaIndex } from '@schema/index';
import type { ElementCache } from './cache';
import type { DataMerger, MergeRequest, MergeResult } from './data-merger';
import type { DependencyMap } from './dependencies';
import { FieldChangeTracker } from './field-changes';
import type { RuntimeDeps, UpdateTransaction } from './runtime-state';
import { FRAGMENT_ATTRIBUTE } from './strategies';
import { hasBindingBelow, SYSTEM_FIELD_NAMES } from './unbound-fields';

/**
 * Renderer keys and Payload types whose value the panel posts complete: a
 * scalar, with nothing inside it and nothing behind it to resolve. One
 * vocabulary answers both questions asked here — whether a page reads anything
 * the server populates, and whether one field does — because they are the same
 * question about a binding and about a value.
 */
const SELF_SUFFICIENT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'textarea',
  'email',
  'number',
  'checkbox',
  'date',
  'select',
  'radio',
  'point',
  'code',
  'json',
  'ui',
  'html',
]);

/** The raw diff answers "what did the editor move", which no dependency map changes. */
const NO_DEPENDENCIES: DependencyMap = {};

export interface MergePlan {
  /** Whether the server can still add something to these values. */
  readonly merge: boolean;
  /** The best document without it: this message's own values over the last resolved one. */
  readonly fields: Record<string, unknown>;
}

export interface CoalescedMerge {
  /** Whether the request went out now. A deferred one lands after the window and refines what was rendered. */
  readonly leading: boolean;
  readonly result: Promise<MergeResult>;
}

interface PendingMerge {
  readonly promise: Promise<MergeResult>;
  readonly settle: (result: MergeResult) => void;
}

export class MergeNeed {
  /** What the panel last posted, so "changed" means what the editor moved, not what population added. */
  private readonly rawChanges = new FieldChangeTracker();
  private resolved: Record<string, unknown> | null = null;
  private queued: MergeRequest | null = null;
  private pending: PendingMerge | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private openUntil = 0;

  /**
   * The decision, in the order the audit found the ways to get it wrong.
   *
   * 1. **Nothing on the page reads a populated value**, either because nobody
   *    reads anything (LP-4) or because every binding renders a plain scalar.
   *    See `readsPopulatedValues`.
   * 2. **Nothing populated moved** (LP-3): the fields the editor changed are
   *    scalars that name no document, so they are taken from the message and
   *    the rest is carried over from what the last merge resolved. Typing a
   *    title costs nothing.
   *
   * What is left needs the server. It still renders at once — from the same
   * carried-over document — so the answer is not what the page waits for;
   * `request()` decides how often it is actually asked.
   */
  decide(deps: RuntimeDeps, transaction: UpdateTransaction): MergePlan {
    const raw = transaction.message.data ?? {};
    // Advanced for every message, including the ones that return here: the next
    // diff has to be against what the panel last posted either way.
    const { changed } = this.rawChanges.diff(raw, NO_DEPENDENCIES);
    if (!readsPopulatedValues(deps)) return { merge: false, fields: raw };
    const base = this.resolved;
    // The first message has nothing to carry over, so it buys the document once.
    if (base === null) {
      this.resolved = raw;
      return { merge: true, fields: raw };
    }
    const fields: Record<string, unknown> = { ...base };
    // A save in another document changes what population returns without moving
    // one value here (LP-1) — the one reason to ask that no field can state.
    let merge = transaction.forceRender;
    for (const field of changed) {
      const value = raw[field];
      if (SYSTEM_FIELD_NAMES.has(field)) {
        fields[field] = value;
        continue;
      }
      const verdict = verdictFor(field, base[field], value, deps.cache, transaction.schemaIndex);
      if (verdict !== 'own') merge = true;
      if (verdict !== 'keep') fields[field] = value;
    }
    this.resolved = fields;
    return { merge, fields };
  }

  /**
   * One request goes out now and the rest of a burst share the one that follows
   * its last message. The abort stays where it was: `DataMerger` still drops an
   * answer a newer request superseded, and what changes here is only how often
   * it is asked.
   *
   * The window is the scheduler's debounce, because it is the same burst: the
   * writes of one are coalesced into a single flush, and this is the request
   * behind them. A page that turns the debounce off turns this off with it.
   */
  request(merger: DataMerger, windowMs: number, request: MergeRequest): CoalescedMerge {
    const now = Date.now();
    if (now >= this.openUntil) {
      // The clock has closed the window, but its timer may not have run: a busy
      // main thread or a throttled engine fires it late. Left queued, that older
      // request would go out after this one, and `DataMerger` — which keeps the
      // newest request — would drop this keystroke's answer; measured in WebKit
      // as a preview one keystroke behind. This request carries the newer values.
      this.dropQueued();
      this.openUntil = now + windowMs;
      return { leading: true, result: merger.merge(request) };
    }
    this.queued = request;
    this.openUntil = now + windowMs;
    this.pending ??= createPending();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush(merger);
    }, windowMs);
    return { leading: false, result: this.pending.promise };
  }

  /** The server's document replaces what was carried over; the next message builds on it. */
  recordMerged(doc: Record<string, unknown>): void {
    this.resolved = doc;
  }

  destroy(): void {
    this.dropQueued();
    this.openUntil = 0;
  }

  /** Drop a queued request; whoever waits on it keeps what they already rendered. */
  private dropQueued(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queued = null;
    this.pending?.settle({ status: 'superseded' });
    this.pending = null;
  }

  private flush(merger: DataMerger): void {
    const pending = this.pending;
    const request = this.queued;
    this.timer = null;
    this.pending = null;
    this.queued = null;
    if (pending === null || request === null) return;
    merger.merge(request).then(pending.settle, () => {
      pending.settle({ status: 'unavailable' });
    });
  }
}

/** What one changed field's own value is worth. */
type FieldVerdict =
  /** Everything the page can render is in it. */
  | 'own'
  /** It can be rendered now, and the server may still complete something inside it. */
  | 'ask'
  /** It is a bare id where a document stood; writing it would put that id on the page. */
  | 'keep';

function verdictFor(
  field: string,
  previous: unknown,
  value: unknown,
  cache: ElementCache,
  schemaIndex: SchemaIndex | undefined,
): FieldVerdict {
  // A structure — a rich-text tree, an array, a group — may hold a reference
  // inside it, and the message's own copy of it is still what the editor typed.
  if (!isScalar(value)) return 'ask';
  if (!isScalar(previous) || namesAReference(field, cache, schemaIndex)) return 'keep';
  // A field that was empty can be filled with either a word or an id, and the
  // two look alike. Render it and ask: a word must not wait for the answer.
  return previous == null ? 'ask' : 'own';
}

/** A document id and a title are both strings; only the schema or a binding says which this is. */
function namesAReference(
  field: string,
  cache: ElementCache,
  schemaIndex: SchemaIndex | undefined,
): boolean {
  const schema = schemaIndex === undefined ? undefined : lookupSchema(schemaIndex, field);
  if (schema !== undefined && !SELF_SUFFICIENT_TYPES.has(schema.type)) return true;
  if (cache.get(field)?.some(rendersAReference) === true) return true;
  // `venue.title` is a page saying the field holds a document; the owner scope
  // is off here on purpose, because a binding in any document still says so.
  return hasBindingBelow(cache, field, false);
}

function rendersAReference(binding: { readonly fieldType: string }): boolean {
  // A project renderer is unknown ground: it may resolve the value itself.
  return !SELF_SUFFICIENT_TYPES.has(binding.fieldType);
}

/**
 * Whether anything on this page reads a value the server would populate.
 *
 * Two findings meet here. LP-4: a page with no binding, no island, no boundary
 * a fragment strategy would render and no listener reading the document has
 * nobody to hand the answer to — measured on such a page, 17 keystrokes cost 19
 * authenticated POSTs. LP-3: a page whose every binding is a plain scalar
 * renderer on a top-level field renders the panel's own values exactly, so the
 * merge could only hand back what the message already carries.
 *
 * The route is deliberately not a reason to ask. Since Z3 an unbound change
 * escalates to it by default, but a refresh re-renders the page from the server
 * and never looks at these values.
 */
function readsPopulatedValues(deps: RuntimeDeps): boolean {
  const { cache, emitter } = deps;
  if (cache.islands.length > 0) return true;
  if (emitter.listenerCount('beforeUpdate') > 0 || emitter.listenerCount('afterUpdate') > 0) {
    return true;
  }
  for (const binding of cache.values()) {
    // A reference renderer, a value with structure, or a path inside a field.
    if (rendersAReference(binding) || binding.fieldName.includes('.')) return true;
    if (isPath(binding.hrefField) || isPath(binding.srcField) || isPath(binding.altField)) {
      return true;
    }
  }
  // A boundary is rendered by a server that is handed exactly these fields.
  return (
    deps.strategies.fragment !== undefined &&
    deps.root.querySelector(`[${FRAGMENT_ATTRIBUTE}]`) !== null
  );
}

function isScalar(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

function isPath(field: string | undefined): boolean {
  return field?.includes('.') === true;
}

function createPending(): PendingMerge {
  let settle!: (result: MergeResult) => void;
  const promise = new Promise<MergeResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}
