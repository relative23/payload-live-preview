/** Populated value shapes the field renderers read. */

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

/** `TSlug` is a phantom marker codegen uses to record the target collection; the runtime shape is identical. */
export interface PayloadRelationship<TSlug extends string = string> {
  readonly id?: string | number;
  readonly title?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly url?: string;
  readonly relationTo?: TSlug;
  readonly [extra: string]: unknown;
}
