/**
 * Type-level path utilities — used by the typed binding DSL to give
 * callers compile-time autocomplete on field names.
 *
 * The same path strings the runtime reads from `data-payload-field`
 * are typed here, so a typo like `'heroTitlee'` is rejected at compile
 * time *and* the runtime side does not need to change.
 *
 * @module @dsl/paths
 */

/**
 * All string-typed top-level keys of `T`. Non-string keys (numeric
 * indices on arrays) are filtered out.
 */
export type FieldName<T> = Extract<keyof T, string>;

/**
 * Dotted paths into nested object structures, capped at three levels
 * deep — sufficient for Payload's `group`/`tab`/`array` nesting
 * without ballooning the IDE's IntelliSense list past the point of
 * usefulness.
 */
export type FieldPath<T, Depth extends 0 | 1 | 2 | 3 = 3> = Depth extends 0
  ? never
  : T extends readonly (infer U)[]
    ? FieldPath<U, Prev<Depth>>
    : T extends object
      ? {
          [K in Extract<keyof T, string>]:
            | K
            | (T[K] extends object ? `${K}.${FieldPath<T[K], Prev<Depth>>}` : never);
        }[Extract<keyof T, string>]
      : never;

/** Decrement helper for depth-bounded recursion. */
type Prev<N extends 0 | 1 | 2 | 3> = N extends 3 ? 2 : N extends 2 ? 1 : N extends 1 ? 0 : 0;

/**
 * Resolve the value type at a dotted path. Returns `unknown` when the
 * path does not exist on `T`, so consumers can opt into stricter
 * `keyof`-based DSLs when they want absolute type safety.
 */
export type ValueAt<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? T[Head] extends readonly (infer U)[]
      ? ValueAt<U, Rest>
      : T[Head] extends object
        ? ValueAt<T[Head], Rest>
        : unknown
    : unknown
  : P extends keyof T
    ? T[P]
    : unknown;
