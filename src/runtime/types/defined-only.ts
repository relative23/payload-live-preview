/** Drops `undefined`-valued keys, so a literal built from optional inputs satisfies `exactOptionalPropertyTypes`. */

export type DefinedOnly<T> = { readonly [K in keyof T]-?: Exclude<T[K], undefined> };

export function definedOnly<T extends object>(source: T): DefinedOnly<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key] = value;
  }
  return result as DefinedOnly<T>;
}
