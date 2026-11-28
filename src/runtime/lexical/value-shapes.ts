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
  readonly sizes?: MediaSizes;
  /** Payload 4's name for `sizes`. */
  readonly variants?: MediaSizes;
}

type MediaSizes = Readonly<
  Record<
    string,
    {
      readonly url?: string;
      readonly width?: number;
      readonly height?: number;
      readonly mimeType?: string;
    }
  >
>;

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

/**
 * A media document's URL as the preview should load it. Unless its config sets
 * `serverURL`, Payload returns a path on its own origin (`/api/media/file/a.png`);
 * its admin resolves the path against the server, and the preview, framed on
 * another origin, would otherwise ask itself for the file. Only such a path is
 * Payload's to place: any other URL, and every URL when no server is known, is
 * written as delivered. A result on another origin than the server's (`/\host`
 * is one, to the URL parser) is discarded.
 */
export function resolveMediaUrl(url: string, serverURL: string | undefined): string {
  if (serverURL === undefined || serverURL === '' || !url.startsWith('/')) return url;
  try {
    const server = new URL(serverURL);
    const resolved = new URL(url, server);
    return resolved.origin === server.origin ? resolved.href : url;
  } catch {
    return url;
  }
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
