/**
 * The schema as static analysis sees it: richer than the runtime's
 * `PayloadFieldSchema` (block definitions, relationship targets, hasMany) and
 * shaped for the emitter.
 */

export interface ExtractedSchema {
  readonly globals: readonly ExtractedSlug[];
  readonly collections: readonly ExtractedSlug[];
  /** What the extractor could not resolve. Every entry is a gap in the output. */
  readonly diagnostics: readonly string[];
}

export interface ExtractedSlug {
  /** The Payload slug (`'homepage'`, `'posts'`, …). */
  readonly slug: string;
  /** PascalCase type name (`'Homepage'`, `'Posts'`, …). */
  readonly typeName: string;
  readonly fields: readonly ExtractedField[];
}

export type ExtractedField =
  | ExtractedScalarField
  | ExtractedArrayField
  | ExtractedBlocksField
  | ExtractedGroupField
  | ExtractedRelationshipField
  | ExtractedUploadField
  | ExtractedJsonField
  | ExtractedSelectField;

interface ExtractedFieldBase {
  readonly name: string;
  readonly required: boolean;
  readonly localized: boolean;
}

export interface ExtractedScalarField extends ExtractedFieldBase {
  readonly kind: 'scalar';
  readonly typeRef: 'string' | 'number' | 'boolean' | 'Date' | '[number, number]' | 'unknown';
  /** `text` and `number` fields may hold several values. */
  readonly hasMany?: boolean;
}

export interface ExtractedArrayField extends ExtractedFieldBase {
  readonly kind: 'array';
  readonly fields: readonly ExtractedField[];
}

export interface ExtractedBlocksField extends ExtractedFieldBase {
  readonly kind: 'blocks';
  readonly blocks: readonly ExtractedBlock[];
}

export interface ExtractedBlock {
  readonly slug: string;
  readonly typeName: string;
  readonly fields: readonly ExtractedField[];
}

export interface ExtractedGroupField extends ExtractedFieldBase {
  readonly kind: 'group';
  readonly fields: readonly ExtractedField[];
}

export interface ExtractedRelationshipField extends ExtractedFieldBase {
  readonly kind: 'relationship';
  readonly target: string | readonly string[];
  readonly hasMany: boolean;
}

export interface ExtractedUploadField extends ExtractedFieldBase {
  readonly kind: 'upload';
  readonly target: string;
  readonly hasMany?: boolean;
}

export interface ExtractedJsonField extends ExtractedFieldBase {
  readonly kind: 'json';
}

/** `select` and `radio`; a radio never has many. */
export interface ExtractedSelectField extends ExtractedFieldBase {
  readonly kind: 'select';
  readonly options: readonly string[];
  readonly hasMany: boolean;
}
