/**
 * Typed helpers emitting the `data-payload-*` attributes the runtime reads.
 * `bindByPath` records the path through a Proxy, so a rename follows.
 */

import type { FieldName } from './paths';

/** A spreadable attribute record: `<h1 {...bind<Homepage>('heroTitle')}>`. */
export interface FieldBindingAttributes {
  readonly 'data-payload-field': string;
  readonly 'data-payload-attribute'?: string;
  readonly 'data-payload-type'?: string;
  readonly 'data-payload-richtext'?: string;
  readonly 'data-payload-html'?: string;
  readonly 'data-payload-locale'?: string;
  readonly 'data-payload-alt'?: string;
  readonly 'data-payload-href'?: string;
  readonly 'data-payload-array-template'?: string;
}

export interface BindOptions {
  /** Attribute to write instead of the text content, e.g. `'src'` for `<img>`. */
  readonly attribute?: string;
  /** Explicit field type, bypassing schema detection. */
  readonly type?: string;
  /** Mark the binding as Lexical rich text; needed only when the initial render is empty. */
  readonly richtext?: boolean;
  /** Render the value as sanitised HTML rather than text. */
  readonly html?: boolean;
  /** Lock this element to one locale, overriding the message locale. */
  readonly locale?: string;
  /** Field whose value becomes the image `alt`. */
  readonly alt?: string;
  /** Field whose value becomes the link `href`. */
  readonly href?: string;
  /** Markup per array item with `{{value}}` placeholders. */
  readonly arrayTemplate?: string;
}

/** `bind<Homepage>('heroTitle')`; without `T` any string is accepted. */
export function bind<T = Record<string, unknown>>(
  field: FieldName<T>,
  options?: BindOptions,
): FieldBindingAttributes {
  return buildAttributes(field, options);
}

/** `bindByPath<Homepage>(d => d.slides[0].title)` → `slides.title`; array indices are dropped because bindings resolve against the schema. */
// `T` is used once, by design: the caller names the document type so the
// picker is checked against it instead of against an untyped `d`.
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
    'data-payload-richtext'?: string;
    'data-payload-html'?: string;
    'data-payload-locale'?: string;
    'data-payload-alt'?: string;
    'data-payload-href'?: string;
    'data-payload-array-template'?: string;
  } = { 'data-payload-field': field };
  if (options?.attribute !== undefined) attrs['data-payload-attribute'] = options.attribute;
  if (options?.type !== undefined) attrs['data-payload-type'] = options.type;
  // Presence attributes: the runtime tests for the attribute, not its value.
  if (options?.richtext === true) attrs['data-payload-richtext'] = '';
  if (options?.html === true) attrs['data-payload-html'] = '';
  if (options?.locale !== undefined) attrs['data-payload-locale'] = options.locale;
  if (options?.alt !== undefined) attrs['data-payload-alt'] = options.alt;
  if (options?.href !== undefined) attrs['data-payload-href'] = options.href;
  if (options?.arrayTemplate !== undefined) {
    attrs['data-payload-array-template'] = options.arrayTemplate;
  }
  return attrs;
}

function recordPath(picker: (data: never) => unknown): string[] {
  const path: string[] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string | symbol): unknown {
        if (typeof prop === 'symbol') return undefined;
        if (/^\d+$/.test(prop)) return proxy;
        path.push(prop);
        return proxy;
      },
    },
  );
  try {
    picker(proxy as never);
  } catch {
    // A picker doing math or JSX on the proxy throws after recording the path it meant.
  }
  return path;
}
