/**
 * Whether an incoming field has somewhere on the page to land.
 *
 * Two callers ask, for different reasons: LP0201 reports a field that never
 * has an anchor, and `onUnfaithfulPatch` decides whether a revision needs the
 * whole route. They have to answer the same way, so the lookup lives here
 * rather than in either of them — the locale suffix Payload appends, the owner
 * scope, and the fact that the diff names top-level fields while a binding may
 * name a path inside one.
 */

import { isBindingInScope } from './binding-owner';
import type { ElementCache } from './cache';
import {
  uncoveredChangedPaths,
  type PathCoverage,
  type SubfieldCoverage,
  type UncoveredPath,
} from './subfield-coverage';

/** Document fields Payload ships in every update that nobody binds to. */
export const SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set([
  'id',
  '_id',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  '_status',
  'globalType',
  'collection',
  'locale',
  'localized',
]);

/** Owner keys as the update resolved them; `false` means scoping is off. */
export type OwnerScope = readonly string[] | null | false;

/** Answers for one update; the locale index behind it is built at most once. */
export type FieldAddressability = (fieldName: string) => boolean;

/**
 * `field_locale` names an element-local locale may consume while the message
 * locale differs, so those bindings are addressable under their suffixed name.
 */
function localisedBindingNames(cache: ElementCache, ownerKeys: OwnerScope): Set<string> {
  const names = new Set<string>();
  for (const [fieldName, bindings] of cache.entries()) {
    for (const binding of bindings) {
      if (ownerKeys !== false && !isBindingInScope(binding.owner, ownerKeys)) continue;
      if (binding.locale !== undefined) names.add(`${fieldName}_${binding.locale}`);
    }
  }
  return names;
}

/**
 * A binding on a path inside the field — `hero.eyebrow` for the field `hero` —
 * makes it addressable. The diff names top-level fields only, so without this
 * every group and array on the page would look unbound.
 */
export function hasBindingBelow(
  cache: ElementCache,
  fieldName: string,
  ownerKeys: OwnerScope,
): boolean {
  const prefix = `${fieldName}.`;
  for (const [boundName, bindings] of cache.entries()) {
    if (!boundName.startsWith(prefix)) continue;
    if (ownerKeys === false) return true;
    if (bindings.some((binding) => isBindingInScope(binding.owner, ownerKeys))) return true;
  }
  return false;
}

/** The strategies configured for this page; only they render what a boundary or marker depends on. */
export interface ServerRendering {
  readonly fragment?: unknown;
  readonly route?: unknown;
}

/**
 * The page's answer for any path in one update's owner scope: the bound names,
 * the declared covers (ADR 0022) and the fields a boundary or route marker
 * depends on when its strategy is configured, read once, then the same name
 * rule the overlay applies.
 */
export function createPathCoverage(
  cache: ElementCache,
  ownerKeys: OwnerScope,
  rendering: ServerRendering = {},
): PathCoverage {
  const inScope = (owner: string | undefined): boolean =>
    ownerKeys === false || isBindingInScope(owner, ownerKeys);
  const names: string[] = [];
  for (const [fieldName, bindings] of cache.entries()) {
    if (bindings.some((binding) => inScope(binding.owner))) names.push(fieldName);
  }
  const rendered = cache.rendered.filter(
    (declaration) => rendering[declaration.strategy] !== undefined,
  );
  const covers = [...cache.covers, ...rendered]
    .filter((cover) => inScope(cover.owner))
    .flatMap((cover) => cover.paths);
  return namePathCoverage(names, covers);
}

export function stripLocaleSuffix(name: string, locale: string | undefined): string {
  if (locale === undefined || locale.length === 0) return name;
  const suffix = `_${locale}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** Whether any binding on the page belongs to the document this update carries. */
export function ownsAnyBinding(cache: ElementCache, ownerKeys: readonly string[] | null): boolean {
  for (const binding of cache.values()) {
    if (isBindingInScope(binding.owner, ownerKeys)) return true;
  }
  return false;
}

/**
 * The same rule for a caller that has names rather than the cache: the
 * `data-payload-field` values in a document, which is all a plugin can see
 * (`src/plugins/built-in/unbound-fields-overlay.ts`).
 *
 * It answers the first three of the four questions below — exact name, the
 * locale-stripped base, a binding on a path inside the field. The fourth needs
 * each binding's own `data-payload-locale`, which is a property of the element
 * rather than of its name, so a caller with names alone cannot ask it.
 */
export function createNameAddressability(
  boundNames: Iterable<string>,
  locale: string | undefined,
  coverPaths: Iterable<string>,
): FieldAddressability {
  const coverage = namePathCoverage(boundNames, coverPaths);
  const reaches = (name: string): boolean => coverage.covers(name) || coverage.reachesBelow(name);
  return (fieldName) => {
    if (reaches(fieldName)) return true;
    const base = stripLocaleSuffix(fieldName, locale);
    return base !== fieldName && reaches(base);
  };
}

/** Coverage from names alone: the bound names and the declared cover paths in a document. */
function namePathCoverage(
  boundNames: Iterable<string>,
  coverPaths: Iterable<string>,
): PathCoverage {
  const names = new Set(boundNames);
  const covers = [...coverPaths];
  const anyBelow = (candidates: Iterable<string>, path: string): boolean => {
    const prefix = `${path}.`;
    for (const candidate of candidates) if (candidate.startsWith(prefix)) return true;
    return false;
  };
  return {
    covers: (path) =>
      names.has(path) || covers.some((cover) => cover === path || path.startsWith(`${cover}.`)),
    reachesBelow: (path) => anyBelow(names, path) || anyBelow(covers, path),
  };
}

/**
 * The declared mode for a caller with names (the overlay): the uncovered paths
 * inside the groups the document reaches only below the top level.
 */
export function uncoveredNamePaths(
  fields: Readonly<Record<string, unknown>>,
  boundNames: Iterable<string>,
  locale: string | undefined,
  coverPaths: Iterable<string>,
): string[] {
  const coverage = namePathCoverage(boundNames, coverPaths);
  const found: string[] = [];
  for (const [fieldName, value] of Object.entries(fields)) {
    if (SYSTEM_FIELD_NAMES.has(fieldName)) continue;
    const root = stripLocaleSuffix(fieldName, locale);
    if (coverage.covers(root) || !coverage.reachesBelow(root)) continue;
    for (const { path } of uncoveredChangedPaths(root, undefined, value, coverage)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The predicate for one update. The localised index is built on first use:
 * most fields are answered by the two cheap lookups before it.
 */
export function createFieldAddressability(
  cache: ElementCache,
  locale: string | undefined,
  ownerKeys: OwnerScope,
  rendering?: ServerRendering,
): FieldAddressability {
  const coverage = createPathCoverage(cache, ownerKeys, rendering);
  const reach = createFieldReach(cache, locale, ownerKeys, coverage);
  return (fieldName) => reach(fieldName) !== 'none';
}

/**
 * How far the page reaches into a field: `whole` when a binding or a cover
 * sits on it, `below` when only paths inside it are bound or covered — the
 * case ADR 0022's declared mode looks into — and `none`.
 */
function createFieldReach(
  cache: ElementCache,
  locale: string | undefined,
  ownerKeys: OwnerScope,
  coverage: PathCoverage = createPathCoverage(cache, ownerKeys),
): (fieldName: string) => 'whole' | 'below' | 'none' {
  let localised: Set<string> | undefined;
  const whole = coverage.covers;
  const below = coverage.reachesBelow;
  return (fieldName) => {
    const base = stripLocaleSuffix(fieldName, locale);
    if (whole(fieldName) || (base !== fieldName && whole(base))) return 'whole';
    localised ??= localisedBindingNames(cache, ownerKeys);
    if (localised.has(fieldName)) return 'whole';
    if (below(fieldName) || (base !== fieldName && below(base))) return 'below';
    return 'none';
  };
}

/** The previous and current message, when the declared mode compares below the top level. */
export interface SubfieldValues {
  readonly previous: Readonly<Record<string, unknown>>;
  readonly next: Readonly<Record<string, unknown>>;
}

/**
 * The declared mode asked of a document rather than a diff, for LP0203: the
 * uncovered paths inside the groups the page reaches only below the top level.
 */
export function uncoveredDocumentPaths(
  cache: ElementCache,
  fields: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  ownerKeys: OwnerScope,
  rendering?: ServerRendering,
): UncoveredPath[] {
  const coverage = createPathCoverage(cache, ownerKeys, rendering);
  const reach = createFieldReach(cache, locale, ownerKeys, coverage);
  const found: UncoveredPath[] = [];
  for (const [fieldName, value] of Object.entries(fields)) {
    if (SYSTEM_FIELD_NAMES.has(fieldName) || reach(fieldName) !== 'below') continue;
    const root = stripLocaleSuffix(fieldName, locale);
    found.push(...uncoveredChangedPaths(root, undefined, value, coverage));
  }
  return found;
}

/** What the declared mode compares for one revision, or `undefined` where it does not apply. */
export function declaredSubfields(
  mode: SubfieldCoverage,
  previous: Readonly<Record<string, unknown>> | undefined,
  next: Readonly<Record<string, unknown>> | undefined,
): SubfieldValues | undefined {
  return mode === 'declared' && previous !== undefined && next !== undefined
    ? { previous, next }
    : undefined;
}

/**
 * The fields a revision changed that the page has nowhere to put: the rule
 * above, asked of a diff instead of a document. Both profiles ask it — the full
 * one to decide whether the whole route is the only honest answer, the lean one
 * because the finding is worth recording even where nothing can act on it — so
 * it stands here, beside the rule it is made of, rather than in either runner.
 */
export function unboundChangedFields(
  cache: ElementCache,
  touched: ReadonlySet<string>,
  locale: string | undefined,
  ownerKeys: OwnerScope,
  subfields?: SubfieldValues,
  rendering?: ServerRendering,
): string[] {
  const coverage = createPathCoverage(cache, ownerKeys, rendering);
  const reach = createFieldReach(cache, locale, ownerKeys, coverage);
  const unbound: string[] = [];
  for (const fieldName of touched) {
    if (SYSTEM_FIELD_NAMES.has(fieldName)) continue;
    const kind = reach(fieldName);
    if (kind === 'none') unbound.push(fieldName);
    if (kind !== 'below' || subfields === undefined) continue;
    const root = stripLocaleSuffix(fieldName, locale);
    const { previous, next } = subfields;
    for (const { path } of uncoveredChangedPaths(
      root,
      previous[fieldName],
      next[fieldName],
      coverage,
    )) {
      unbound.push(path);
    }
  }
  return unbound;
}
