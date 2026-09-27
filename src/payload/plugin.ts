/**
 * `payload-live-preview/plugin` configures Payload 2 or 3 without importing
 * either version. It owns URL selection and root preview metadata, while
 * authentication remains an explicit server-side integration.
 */
import { buildLivePreviewUrl, type LivePreviewUrlArgs } from './index';

export interface LivePreviewBreakpoint {
  readonly name: string;
  readonly label: string;
  readonly width: number | string;
  readonly height: number | string;
}

export interface LivePreviewPluginOptions {
  /** Frontend origin, e.g. `https://site.example`. */
  readonly baseUrl: string;
  /** Per-collection path resolvers keyed by collection slug. */
  readonly collections?: Readonly<
    Record<
      string,
      | string
      | ((context: {
          readonly data: Record<string, unknown>;
          readonly locale: string | undefined;
        }) => string)
    >
  >;
  /** Per-global path resolvers keyed by global slug. */
  readonly globals?: Readonly<
    Record<
      string,
      | string
      | ((context: {
          readonly data: Record<string, unknown>;
          readonly locale: string | undefined;
        }) => string)
    >
  >;
  /** Path used when no resolver matches or one returns `''`. Default `/`. */
  readonly fallback?: string;
  /** Preview-intent query parameter. Keep it in the frontend adapter's `previewQueryParams`; `null` needs another intent signal. */
  readonly previewParam?: string | null;
  /** Device sizes displayed by Payload's live-preview toolbar. */
  readonly breakpoints?: readonly LivePreviewBreakpoint[];
}

type UnknownRecord = Record<string, unknown>;

/** Configure mapped entities and one shared live-preview URL callback. */
export function livePreview(
  options: LivePreviewPluginOptions,
): <TConfig extends object>(config: TConfig) => TConfig {
  const resolveUrl = buildLivePreviewUrl(options);
  const collectionSlugs = Object.keys(options.collections ?? {});
  const globalSlugs = Object.keys(options.globals ?? {});

  return <TConfig extends object>(config: TConfig): TConfig => {
    const root = config as UnknownRecord;
    const admin = record(root['admin']);
    const current = record(admin['livePreview']);
    const currentUrl = current['url'];

    if (Object.hasOwn(current, 'url') && currentUrl !== resolveUrl) {
      throw new Error(
        'payload-live-preview/plugin cannot replace an existing admin.livePreview.url',
      );
    }

    assertNoEntityUrl(root['collections'], collectionSlugs, 'collection');
    assertNoEntityUrl(root['globals'], globalSlugs, 'global');

    const configured: UnknownRecord = {
      ...current,
      collections: stableUnion(current['collections'], collectionSlugs),
      globals: stableUnion(current['globals'], globalSlugs),
      url: resolveUrl satisfies (args: LivePreviewUrlArgs) => string,
    };
    if (options.breakpoints !== undefined) {
      configured['breakpoints'] = options.breakpoints.map((breakpoint) => ({ ...breakpoint }));
    }

    return {
      ...root,
      admin: {
        ...admin,
        livePreview: configured,
      },
    } as TConfig;
  };
}

function assertNoEntityUrl(
  entities: unknown,
  selectedSlugs: readonly string[],
  kind: 'collection' | 'global',
): void {
  if (!Array.isArray(entities) || selectedSlugs.length === 0) return;
  const selected = new Set(selectedSlugs);
  for (const candidate of entities) {
    const entity = record(candidate);
    const slug = entity['slug'];
    if (typeof slug !== 'string' || !selected.has(slug)) continue;
    const livePreviewConfig = record(record(entity['admin'])['livePreview']);
    if (Object.hasOwn(livePreviewConfig, 'url')) {
      throw new Error(
        `payload-live-preview/plugin cannot configure ${kind} "${slug}" because it already has admin.livePreview.url`,
      );
    }
  }
}

function stableUnion(existing: unknown, additions: readonly string[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  const current: readonly unknown[] = Array.isArray(existing)
    ? (existing as readonly unknown[])
    : [];
  const candidates: readonly unknown[] = [...current, ...additions];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function record(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : {};
}
