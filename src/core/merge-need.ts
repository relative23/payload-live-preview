/**
 * Whether an accepted message has to be resolved against the server before the
 * page can render it, and how many round trips a burst of them may cost. The
 * merge exists to populate relationships and uploads, so a page that renders
 * none of them needs no request at all. A message in the same locale that moved
 * no populated field is answered from its own values over what the last merge
 * resolved, and what is left goes out once at the start of a burst and once at
 * its end.
 *
 * Conservative in one direction on purpose: a request left out that was needed
 * puts an id where a name belongs and leaves it there, while one request too
 * many costs a round trip nobody sees.
 */

import { lookupSchema, type SchemaIndex } from '@schema/index';
import type { ElementCache } from './cache';
import type { DataMerger, MergeRequest, MergeResult } from './data-merger';
import type { DependencyMap } from './dependencies';
import { looksLikeLexicalRoot } from './binding-writer';
import { bindingValue } from './field-value';
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

/**
 * Lexical nodes whose whole content is in the message. Anything else — an
 * upload, a relationship, a block, a node this package does not know — may name
 * a document the server fills in, and so may a link whose target is one.
 */
const SELF_SUFFICIENT_NODES: ReadonlySet<string> = new Set([
  'root',
  'paragraph',
  'text',
  'heading',
  'quote',
  'list',
  'listitem',
  'linebreak',
  'tab',
  'horizontalrule',
  'code',
  'code-highlight',
  'table',
  'tablerow',
  'tablecell',
  'link',
  'autolink',
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

interface TrailingMerge {
  readonly request: MergeRequest;
  readonly pending: PendingMerge;
  timer: ReturnType<typeof setTimeout> | null;
}

export class MergeNeed {
  /** Raw fields last considered for population, without confusing edits with server-added values. */
  private readonly rawChanges = new FieldChangeTracker();
  private resolved: Record<string, unknown> | null = null;
  /** Null leaves required population unresolved; undefined is the resolved default locale. */
  private resolvedLocale: string | undefined | null = null;
  private trailing: TrailingMerge | null = null;
  private openUntil = 0;
  private requestAttempt = 0;

  /**
   * The decision, in the order the audit found the ways to get it wrong.
   *
   * 1. **Nothing on the page reads a populated value**, either because nobody
   *    reads anything (LP-4) or because every binding renders a plain scalar.
   *    See `readsPopulatedValues`. A binding that declares no type and holds
   *    rich text naming a document is not plain, whatever its element says:
   *    see `rendersRichTextByShape`.
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
    const raw = transaction.rawData;
    if (
      !readsPopulatedValues(deps) &&
      !rendersRichTextByShape(deps.cache, raw, transaction.locale)
    ) {
      if (transaction.forceRender) this.resolvedLocale = null;
      return { merge: false, fields: raw };
    }
    // Unobserved edits still need comparison when a population consumer returns.
    const { changed } = this.rawChanges.diff(raw, NO_DEPENDENCIES);
    // Population depends on the accepted locale even when relationship IDs stay
    // put. A page with no population consumer leaves the retained context alone.
    const localeChanged = this.resolvedLocale !== transaction.locale;
    const base = this.resolved;
    // The first message has nothing to carry over, so it buys the document once.
    if (base === null) {
      this.resolved = raw;
      return { merge: true, fields: raw };
    }
    const fields: Record<string, unknown> = { ...base };
    // A related save (LP-1) or an accepted locale change can alter population
    // without moving a relationship ID in the raw form values.
    if (transaction.forceRender) this.resolvedLocale = null;
    let merge = transaction.forceRender || localeChanged;
    for (const field of changed) {
      const value = raw[field];
      if (SYSTEM_FIELD_NAMES.has(field)) {
        fields[field] = value;
        continue;
      }
      const verdict = verdictFor(field, base[field], value, deps.cache, transaction.schemaIndex);
      if (verdict !== 'own') {
        merge = true;
        this.resolvedLocale = null;
      }
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
    const attempt = ++this.requestAttempt;
    const now = Date.now();
    if (now >= this.openUntil) {
      // The clock has closed the window, but its timer may not have run: a busy
      // main thread or a throttled engine fires it late. Left queued, that older
      // request would go out after this one, and `DataMerger` — which keeps the
      // newest request — would drop this keystroke's answer; measured in WebKit
      // as a preview one keystroke behind. This request carries the newer values.
      this.openUntil = now + windowMs;
      this.dropQueued();
      // Cancellation can accept newer work before this leading request dispatches.
      if (this.requestAttempt !== attempt) {
        return { leading: true, result: Promise.resolve({ status: 'superseded' }) };
      }
      return { leading: true, result: merger.merge(request) };
    }
    const previous = this.trailing;
    const pending = previous?.pending ?? createPending();
    const trailing: TrailingMerge = { request, pending, timer: null };
    this.trailing = trailing;
    this.openUntil = now + windowMs;
    if (previous !== null && previous.timer !== null) clearTimeout(previous.timer);
    if (this.trailing !== trailing) return { leading: false, result: pending.promise };
    const timer = setTimeout(() => {
      this.flush(merger, trailing);
    }, windowMs);
    if (this.trailing === trailing) trailing.timer = timer;
    else clearTimeout(timer);
    return { leading: false, result: pending.promise };
  }

  /** The server's document replaces what was carried over; the next message builds on it. */
  recordMerged(doc: Record<string, unknown>, locale?: string): void {
    this.resolved = doc;
    this.resolvedLocale = locale;
  }

  /** Start a navigation replay from a raw baseline while retaining the last complete server document. */
  resetRawChanges(): void {
    this.rawChanges.reset();
  }

  destroy(): void {
    this.requestAttempt += 1;
    this.openUntil = 0;
    this.dropQueued();
  }

  /** Drop a queued request; whoever waits on it keeps what they already rendered. */
  private dropQueued(): void {
    const trailing = this.trailing;
    this.trailing = null;
    if (trailing === null) return;
    if (trailing.timer !== null) clearTimeout(trailing.timer);
    trailing.pending.settle({ status: 'superseded' });
  }

  private flush(merger: DataMerger, trailing: TrailingMerge): void {
    // A cancelled callback must never consume a successor's queued request.
    if (this.trailing !== trailing) return;
    this.trailing = null;
    trailing.timer = null;
    // The owned DataMerger fulfills one of its three outcomes, including request failures.
    void merger.merge(trailing.request).then(trailing.pending.settle);
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

/**
 * Whether a binding that declares no type holds rich text with something in it
 * the server fills in. The writer renders a Lexical root as rich text whatever
 * the element says (binding-writer.ts), and Payload 3's admin posts the nodes
 * inside it as bare IDs, so without this the image in a rich-text field was
 * written from its ID — which draws nothing — on a page that marked the
 * element with `data-payload-field` alone. Asked of the value, because the
 * same field holds an upload in one message and none in the next.
 */
function rendersRichTextByShape(
  cache: ElementCache,
  raw: Record<string, unknown>,
  locale: string | undefined,
): boolean {
  for (const binding of cache.values()) {
    // A declared type is what the writer renders; only the default `text` goes by the shape.
    if (binding.fieldType !== 'text' || binding.explicitFieldType === true) continue;
    // Read as the writer reads it, the binding's own locale first.
    const value = bindingValue(raw, binding, binding.fieldName, locale);
    if (looksLikeLexicalRoot(value) && holdsReference((value as { root: unknown }).root)) {
      return true;
    }
  }
  return false;
}

/**
 * Walked with a stack rather than recursion, because the editor decides how
 * deep a tree goes. A message is a structured clone, which keeps a cycle, so a
 * node is walked once.
 */
function holdsReference(root: unknown): boolean {
  const pending: unknown[] = [root];
  const seen = new Set<object>();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (typeof node !== 'object' || node === null || seen.has(node)) continue;
    seen.add(node);
    const { type, fields, children } = node as {
      readonly type?: unknown;
      readonly fields?: { readonly linkType?: unknown } | null;
      readonly children?: unknown;
    };
    // `has` answers false for a type that is missing or not a string, and that node is asked for too.
    if (!SELF_SUFFICIENT_NODES.has(type as string)) return true;
    if (fields?.linkType === 'internal') return true;
    if (Array.isArray(children)) for (const child of children as unknown[]) pending.push(child);
  }
  return false;
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
