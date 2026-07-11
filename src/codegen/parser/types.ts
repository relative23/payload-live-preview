/**
 * Internal schema representation used by the codegen pipeline.
 *
 * Decoupled from `PayloadFieldSchema` (the runtime shape that arrives
 * via postMessage) because:
 *
 *   1. Static analysis sees richer information — block definitions,
 *      relationship targets, hasMany — that the runtime shape may not
 *      always carry.
 *   2. The emit phase wants ergonomic structures (TypeScript-like
 *      type references) that the runtime never needs.
 *
 * @module @codegen/parser/types
 */

export interface ExtractedSchema {
  readonly globals: readonly ExtractedSlug[];
  readonly collections: readonly ExtractedSlug[];
  /** Diagnostics produced during extraction. Soft warnings only. */
  readonly diagnostics: readonly string[];
}

export interface ExtractedSlug {
  /** The Payload slug (`'homepage'`, `'posts'`, …). */
  readonly slug: string;
  /** PascalCase type name (`'Homepage'`, `'Post'`, …). */
  readonly typeName: string;
  /** Fully-resolved field tree. */
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
  readonly typeRef:
    | 'string'
    | 'number'
    | 'boolean'
    | 'Date'
    | 'unknown' /* code / point / ui / fallback */;
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
}

export interface ExtractedJsonField extends ExtractedFieldBase {
  readonly kind: 'json';
}

export interface ExtractedSelectField extends ExtractedFieldBase {
  readonly kind: 'select';
  readonly options: readonly string[];
  readonly hasMany: boolean;
}
