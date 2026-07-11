/**
 * Typed binding helpers — emit the `data-payload-field` attribute pair
 * that the live-preview runtime reads, with compile-time validation
 * of the field name.
 *
 * Two forms are exposed:
 *
 *   - **`bind<Schema>('heroTitle')`** — string-literal form. Lightest
 *     possible runtime (no Proxy), but a rename in the IDE does NOT
 *     follow into the string.
 *   - **`bindByPath<Schema>(s => s.heroTitle)`** — proxy form. The
 *     callback walks a Proxy that records the access path, returning
 *     the same shape as `bind` so the two are interchangeable. Slightly
 *     heavier runtime, but rename-safe and discourages typos.
 *
 * Both helpers also accept a richer return — `bind('image', 'src')` —
 * to bind an attribute other than the default `data-payload-field`,
 * matching the cache resolver's `data-payload-attribute` flow.
 *
 * @module @dsl/bind
 */

import type { FieldName } from './paths';

/**
 * Shape returned by every binding helper — a spreadable HTML attribute
 * record. Astro / JSX / Svelte all accept this style directly:
 *
 *   ```astro
 *   <h1 {...bind<Homepage>('heroTitle')}>{data.heroTitle}</h1>
 *   ```
 */
export interface FieldBindingAttributes {
  readonly 'data-payload-field': string;
  readonly 'data-payload-attribute'?: string;
  readonly 'data-payload-type'?: string;
}

export interface BindOptions {
  /** Override the bound attribute (e.g., `'src'` for `<img>`). Default: textContent. */
  readonly attribute?: string;
  /** Explicit field-type override — bypasses schema detection. */
  readonly type?: string;
}

/**
 * String-literal binding helper.
 *
 *   ```ts
 *   import { bind } from '@relative23/payload-live-preview';
 *   import type { Homepage } from './payload-types';
 *
 *   <h1 {...bind<Homepage>('heroTitle')}>{data.heroTitle}</h1>
 *   <img {...bind<Homepage>('heroImage', { attribute: 'src' })} />
 *   ```
 *
 * The generic `T` is the schema interface emitted by `pll-codegen`.
 * `field` is constrained to `keyof T` so misspellings fail at compile
 * time. When `T` is omitted, the helper accepts any string — useful
 * for incremental adoption.
 */
export function bind<T = Record<string, unknown>>(
  field: FieldName<T>,
  options?: BindOptions,
): FieldBindingAttributes {
  return buildAttributes(field, options);
}

/**
 * Proxy-path binding helper.
 *
 *   ```ts
 *   <h1 {...bindByPath<Homepage>(d => d.heroTitle)}>{data.heroTitle}</h1>
 *   ```
 *
 * The picker is invoked once with a recording Proxy; the recorded path
 * is joined with `.` and emitted as the binding name. Property access
 * on nested objects and arrays both work — `d => d.slides[0].title`
 * becomes `slides.title` (array indices are normalised away because the
 * runtime resolves bindings against schema, not against positional
 * indices).
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function bindByPath<T = Record<string, unknown>>(
  picker: (data: T) => unknown,
  options?: BindOptions,
): FieldBindingAttributes {
  const path = recordPath(picker);
  if (path.length === 0) {
    throw new Error(
      'bindByPath: the picker did not read any field — return data.<field> instead of a constant',
    );
  }
  return buildAttributes(path.join('.'), options);
}


function buildAttributes(field: string, options: BindOptions | undefined): FieldBindingAttributes {
  if (field.length === 0) {
    throw new Error('bind: field name must be a non-empty string');
  }
  const attrs: {
    'data-payload-field': string;
    'data-payload-attribute'?: string;
    'data-payload-type'?: string;
  } = { 'data-payload-field': field };
  if (options?.attribute !== undefined) attrs['data-payload-attribute'] = options.attribute;
  if (options?.type !== undefined) attrs['data-payload-type'] = options.type;
  return attrs;
}

function recordPath(picker: (data: never) => unknown): string[] {
  const path: string[] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string | symbol): unknown {
        if (typeof prop === 'symbol') return undefined;
        // Arrays surface numeric indices when iterated — skip those.
        if (/^\d+$/.test(prop)) return proxy;
        path.push(prop);
        return proxy;
      },
    },
  );
  try {
    picker(proxy as never);
  } catch {
    // Pickers can throw when they attempt math/JSX on the proxy. We
    // still keep whatever path was recorded up to that point — that's
    // typically the binding the user intended.
  }
  return path;
}
