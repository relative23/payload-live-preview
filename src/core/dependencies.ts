/**
 * One source → dependents map for `skipUnchanged`. Markup declares it the
 * other way round (`data-payload-depends="price"` on the element bound to
 * `priceLabel`) because an author names what a binding needs; the runtime
 * option is keyed by source because the scheduler asks what changed.
 */

export type DependencyMap = Readonly<Record<string, readonly string[]>>;

/**
 * Field names from an attribute value. Separators are commas and
 * whitespace; empty entries are dropped; order is kept, duplicates removed.
 */
export function parseDependencyList(value: string | null | undefined): readonly string[] {
  if (value === null || value === undefined) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of value.split(/[\s,]+/)) {
    const name = raw.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Merge dependency maps (source → dependents). Later maps add to earlier
 * ones; a dependent is listed once per source.
 */
export function mergeDependencyMaps(...maps: readonly DependencyMap[]): DependencyMap {
  const merged = new Map<string, Set<string>>();
  for (const map of maps) {
    for (const [source, dependents] of Object.entries(map)) {
      let bucket = merged.get(source);
      if (bucket === undefined) {
        bucket = new Set();
        merged.set(source, bucket);
      }
      for (const dependent of dependents) bucket.add(dependent);
    }
  }
  const result: Record<string, readonly string[]> = {};
  for (const [source, dependents] of merged) result[source] = [...dependents];
  return result;
}

/**
 * The map an element's `data-payload-depends` contributes: every declared
 * source points at this binding's field.
 */
export function dependencyMapFromBinding(
  fieldName: string,
  dependsOn: readonly string[],
): DependencyMap {
  const map: Record<string, readonly string[]> = {};
  for (const source of dependsOn) {
    if (source === fieldName) continue;
    map[source] = [fieldName];
  }
  return map;
}
