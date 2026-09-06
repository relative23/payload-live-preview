/**
 * Find the places in a template where a field value is printed on its own, and
 * decide — never guess — which of them can carry a binding.
 *
 * The shape this recognises is deliberately narrow, and it is the same in every
 * template language the package adapts:
 *
 * ```
 * <h1>{page.title}</h1>          Astro, JSX, Svelte
 * ```
 *
 * An element whose entire content is one member expression, rooted at some
 * variable, whose remaining path is a field the schema actually has. Everything
 * else — an interpolation next to text, a call, a ternary, a path the schema
 * does not know, a component instead of an element — is reported instead, with
 * the reason. A wrong `data-payload-field` is worse than a missing one: it makes
 * the runtime write a value into markup that was never meant for it.
 *
 * Markup rather than an AST on purpose. Astro and Svelte templates are not
 * TypeScript, so ts-morph would only cover the JSX third of the problem, and
 * three parsers would be three chances to disagree about which shape is safe.
 * The shape above is unambiguous enough to scan for.
 */

/** A place that can carry a binding, with the attribute it should get. */
export interface AnnotationCandidate {
  /** Offset where the attribute is inserted, inside the opening tag. */
  readonly insertAt: number;
  /** The binding path, as `data-payload-field` must spell it. */
  readonly path: string;
  /** 1-based line, for the report. */
  readonly line: number;
  readonly tag: string;
}

/** A place that looks like an output but was left alone, and why. */
export interface AnnotationRefusal {
  readonly line: number;
  readonly reason: string;
  /** The source of the interpolation, trimmed, for the report. */
  readonly expression: string;
}

export interface ScanResult {
  readonly candidates: readonly AnnotationCandidate[];
  readonly refusals: readonly AnnotationRefusal[];
}

export interface ScanOptions {
  /** Field paths the schema has, exactly as a binding must spell them. */
  readonly paths: ReadonlySet<string>;
}

/**
 * `<tag attrs>content</tag>` with no element inside it, the closing tag
 * repeating the name. Only lowercase tags: an uppercase one is a component,
 * whose children are its own business.
 */
const ELEMENT = /<([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>([^<]*)<\/\1\s*>/gu;

/** The whole content is one interpolation, and nothing else. */
const ONLY_INTERPOLATION = /^\s*\{([^{}]*)\}\s*$/u;

/** An interpolation somewhere in the content, which is a different case. */
const ANY_INTERPOLATION = /\{([^{}]*)\}/u;

/** A plain member chain: `page.title`, `data.hero.eyebrow`. Nothing callable, nothing indexed. */
const MEMBER_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/u;

const FIELD_ATTRIBUTE = 'data-payload-field';

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (source.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

/**
 * The binding path a chain would address: everything after the root variable.
 * `page.hero.title` → `hero.title`, and a lone `title` is not a chain at all —
 * a bare identifier says nothing about which document it came from.
 */
function pathOf(chain: string): string {
  return chain.slice(chain.indexOf('.') + 1);
}

function describe(expression: string): string {
  const flat = expression.replace(/\s+/gu, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

/** Why this interpolation cannot become a binding, in the words of the report. */
function refusalReason(expression: string, paths: ReadonlySet<string>): string | undefined {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return 'the element is empty';
  if (!MEMBER_CHAIN.test(trimmed)) {
    return 'not a plain field access — a call, an operator or an index cannot be traced to one field';
  }
  const path = pathOf(trimmed);
  if (!paths.has(path)) {
    return `the schema has no field \`${path}\`; the binding would name something that never arrives`;
  }
  return undefined;
}

export function scanTemplate(source: string, options: ScanOptions): ScanResult {
  const candidates: AnnotationCandidate[] = [];
  const refusals: AnnotationRefusal[] = [];
  for (const match of source.matchAll(ELEMENT)) {
    const [, tag = '', attributes = '', content = ''] = match;
    const line = lineAt(source, match.index);
    if (attributes.includes(FIELD_ATTRIBUTE)) continue;
    const only = ONLY_INTERPOLATION.exec(content);
    if (only === null) {
      // A value printed beside a label — `Published {page.publishedAt}`. The
      // runtime writes an element's whole text, so a binding here would eat the
      // label; splitting the markup is a decision for whoever wrote it.
      const beside = ANY_INTERPOLATION.exec(content);
      if (beside !== null) {
        refusals.push({
          line,
          reason:
            'the value is printed beside other content — a binding replaces the whole text, so the markup has to be split first',
          expression: describe(content),
        });
      }
      continue;
    }
    const expression = only[1] ?? '';
    const reason = refusalReason(expression, options.paths);
    if (reason !== undefined) {
      refusals.push({ line, reason, expression: describe(expression) });
      continue;
    }
    candidates.push({
      // After `<tag`, before whatever the element already carries.
      insertAt: match.index + 1 + tag.length,
      path: pathOf(expression.trim()),
      line,
      tag,
    });
  }
  return { candidates, refusals };
}

/** Apply the candidates back-to-front, so every earlier offset still holds. */
export function applyAnnotations(
  source: string,
  candidates: readonly AnnotationCandidate[],
): string {
  let out = source;
  for (const candidate of [...candidates].sort((a, b) => b.insertAt - a.insertAt)) {
    out = `${out.slice(0, candidate.insertAt)} ${FIELD_ATTRIBUTE}="${candidate.path}"${out.slice(candidate.insertAt)}`;
  }
  return out;
}
