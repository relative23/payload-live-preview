/**
 * What the runtime does about a patch it knows will not reach what the server
 * would have drawn: a renderer that refused the value, a Lexical block whose
 * markup the write had to drop. The finding is made where the write happens;
 * the policy and the ledger live here, so the pipeline can hand the region to a
 * strategy once the flush is over instead of leaving the page worse off.
 *
 * A changed field with no binding at all is the same judgement made one step
 * earlier — there is no element to write to — and `StrategyRunner` reaches it
 * from `unbound-fields.ts` before anything is scheduled.
 */

import type { RuntimeDeps, RuntimeState } from './runtime-state';
import type { CachedElement } from './types';

/**
 * `'ignore'` keeps the degraded patch, which is what 2.0 shipped under the
 * name `onUnboundChange: 'ignore'`. `'warn'` keeps it and says so (LP0411).
 * `'escalate'`, the default, asks a server to draw the region instead: the
 * fragment strategy when a boundary covers the binding, the route otherwise.
 *
 * Without a strategy to escalate to, every mode keeps the patch. A page that
 * cannot ask a server for better markup is not helped by being told twice.
 */
export type UnfaithfulPatchMode = 'ignore' | 'warn' | 'escalate';

/**
 * Both spellings of the option; the 2.0 name stays until 3.0. Explicitly
 * `| undefined`, because one caller reads them out of the inline script's
 * positional tuple, where an omitted slot is exactly that.
 */
export interface UnfaithfulPatchOptions {
  readonly onUnfaithfulPatch?: UnfaithfulPatchMode | undefined;
  readonly onUnboundChange?: 'ignore' | 'route' | undefined;
}

/**
 * The 2.0 name maps onto the new one without loss: `'route'` was this option's
 * escalation and `'ignore'` its opt-out. Only an omitted option takes the new
 * default — a project that wrote `'ignore'` down chose it, and keeps it.
 */
export function resolveUnfaithfulPatchMode(options: UnfaithfulPatchOptions): UnfaithfulPatchMode {
  // `'ignore'` is the only thing the old name can still say that the new
  // default does not: its `'route'` and its absence both mean escalate now.
  return (
    options.onUnfaithfulPatch ?? (options.onUnboundChange === 'ignore' ? 'ignore' : 'escalate')
  );
}

/**
 * Record one binding this revision could not patch faithfully, and queue it for
 * the escalation the flush will run.
 *
 * Once per element, for the same reason every other diagnostic here is: the
 * cause is the markup or the value's shape, so the next message would report
 * the same thing. Under `'escalate'` that also stops a value the renderer keeps
 * refusing from becoming one route refresh per keystroke.
 */
export function reportUnfaithfulPatch(
  deps: RuntimeDeps,
  state: RuntimeState,
  target: CachedElement,
  reason: string,
): void {
  const mode = deps.onUnfaithfulPatch;
  if (mode === 'ignore' || state.reportedUnfaithful.has(target.element)) return;
  state.reportedUnfaithful.add(target.element);
  if (mode === 'warn') {
    deps.warn(`[live-preview] LP0411: "${target.fieldName}" ${reason}`);
    return;
  }
  deps.log('LP0411', target.fieldName, reason);
  state.unfaithfulPatches.push(target);
}

/**
 * Renderers that turn a stored value into a presentation, so the template that
 * printed the same field had to choose one too. A `text` binding whose content
 * differs is an edit; a `date`, `number` or `checkbox` binding whose content
 * differs is two answers to the question the runtime cannot ask —
 * `data-payload-format` is where the answer belongs.
 */
const FORMATTING_RENDERERS: ReadonlySet<string> = new Set(['date', 'number', 'checkbox']);

/** Cap on either reading in the message: a diagnostic is a pointer, not a dump. */
const EXCERPT = 40;

/**
 * What the element shows, when a difference there would be worth reporting —
 * `undefined` when it would not, so an ordinary page pays one `Set` lookup per
 * binding and reads no DOM at all.
 *
 * Called before the renderer writes, and only for the first write to a
 * binding: after that the element holds the runtime's own output, and
 * comparing it with the runtime's next output says nothing about the template.
 */
export function watchServerFormatting(
  deps: RuntimeDeps,
  state: RuntimeState,
  target: CachedElement,
  type: string,
): string | undefined {
  if (deps.onUnfaithfulPatch === 'ignore') return undefined;
  if (target.format !== undefined || !FORMATTING_RENDERERS.has(type)) return undefined;
  if (state.checkedServerFormat.has(target.element)) return undefined;
  state.checkedServerFormat.add(target.element);
  const shown = shownValue(target.element);
  // An empty anchor lost nothing, and the boundary case (LP0201) is elsewhere.
  return shown.trim().length > 0 ? shown : undefined;
}

/**
 * Called once the renderer has written: both readings of the same value now
 * exist, and if they differ the page no longer matches the server.
 *
 * It reports and stops there. Escalating would hand the region to the route,
 * which redraws the template's format, which the re-apply overwrites again —
 * measured under Z3 — so the honest move is to name the two candidates and the
 * attribute that settles either of them.
 */
export function reportServerFormatting(
  deps: RuntimeDeps,
  target: CachedElement,
  before: string,
): void {
  const after = shownValue(target.element);
  if (after === before) return;
  deps.warn(
    `[live-preview] LP0412: "${target.fieldName}" showed ${excerpt(before)}, the patch wrote ` +
      `${excerpt(after)} — either an edit that arrived before the preview connected, or a ` +
      'template that formats this value differently. Set data-payload-format to match it.',
  );
}

/** The channel the date, number and checkbox renderers write. */
function shownValue(element: Element): string {
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    return (element as HTMLInputElement).value;
  }
  return element.textContent;
}

function excerpt(value: string): string {
  const text = value.trim();
  return JSON.stringify(text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text);
}
