/**
 * Value-shape helpers shared by the Lexical node renderers and the field
 * renderers. They live here because `field-types` may import `lexical`, never
 * the reverse (scripts/architecture-policy.ts).
 */

export interface MediaShape {
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

export interface RelationShape {
  readonly id?: string | number;
  readonly title?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly url?: string;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readMedia(value: unknown): MediaShape | undefined {
  return asRecord(value);
}

/** Reduce `value` to `[a-z0-9_-]` so it can be a class-name fragment without escaping. */
export function sanitizeIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Label precedence for a populated relation: `title`, `name`, `slug`, then `id`. */
export function pickRelationLabel(value: RelationShape): string | undefined {
  const label = nonEmpty(value.title) ?? nonEmpty(value.name) ?? nonEmpty(value.slug);
  if (label !== undefined) return label;
  return value.id === undefined ? undefined : String(value.id);
}
