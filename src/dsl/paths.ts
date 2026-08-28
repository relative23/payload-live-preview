/** Type-level field paths, so a binding name is checked at compile time against the codegen schema. */

/** String keys of `T`. */
export type FieldName<T> = Extract<keyof T, string>;

/** Dotted paths into `T`, capped at three levels so IntelliSense stays usable. */
export type FieldPath<T, Depth extends 0 | 1 | 2 | 3 = 3> = Depth extends 0
  ? never
  : T extends readonly (infer U)[]
    ? FieldPath<U, Prev<Depth>>
    : T extends object
      ? {
          [K in Extract<keyof T, string>]:
            K | (T[K] extends object ? `${K}.${FieldPath<T[K], Prev<Depth>>}` : never);
        }[Extract<keyof T, string>]
      : never;

type Prev<N extends 0 | 1 | 2 | 3> = N extends 3 ? 2 : N extends 2 ? 1 : N extends 1 ? 0 : 0;

/** The value type at a dotted path, or `unknown` when the path does not exist. */
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
