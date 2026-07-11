/**
 * Shared shapes for the field-type renderers.
 *
 * @module @field-types/types
 */

export interface PayloadMedia {
  readonly id?: string | number;
  readonly url?: string;
  readonly alt?: string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly width?: number;
  readonly height?: number;
  readonly sizes?: Readonly<
    Record<string, { readonly url?: string; readonly width?: number; readonly height?: number }>
  >;
}

/**
 * Generic relationship payload. The optional `TSlug` parameter is a
 * phantom marker that codegen uses to record the target collection(s)
 * without changing the runtime shape — `PayloadRelationship<'users'>`
 * and `PayloadRelationship<'users' | 'authors'>` behave identically at
 * runtime but carry different types at compile time.
 */
export interface PayloadRelationship<TSlug extends string = string> {
  readonly id?: string | number;
  readonly title?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly url?: string;
  readonly relationTo?: TSlug;
  readonly [extra: string]: unknown;
}
