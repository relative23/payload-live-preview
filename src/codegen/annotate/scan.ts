/**
 * Find the places in a template where a field value is printed on its own, and
 * decide — never guess — which of them can carry a binding.
 *
 * The shape this recognises is deliberately narrow, and it is the same in every
 * template language the package adapts:
 *
 * ```
 * <h1 data-payload-field="title">{page.title}</h1>    bound by hand
 * <p>{page.subtitle}</p>                               → subtitle
 * ```
 *
 * An element whose entire content is one member expression, rooted at a
 * variable the file already binds a field of by hand, whose remaining path a
 * collection or global has together with those hand-bound fields. The hand
 * binding is the only thing in a template that says which variable holds the
 * previewed document: `post` in a card, `settings` in a footer and `page` in a
 * route look alike, and on four sites 16 of the 17 bindings proposed without
 * it were wrong, most of them a field of some other document. Everything
 * else — an interpolation next to text, a call, a path the schema does not
 * know, a component instead of an element — is reported instead, with
 * the reason. A wrong `data-payload-field` is worse than a missing one: it
 * makes the runtime write a value into markup that was never meant for it.
 *
 * Markup rather than an AST on purpose. Astro and Svelte templates are not
 * TypeScript, so ts-morph would only cover the JSX third of the problem, and
 * three parsers would be three chances to disagree about which shape is safe.
 * The shape above is unambiguous enough to scan for.
 */

/** A place that can carry a binding, with the attribute it should get. @internal */
export interface AnnotationCandidate {
  /** Offset where the attribute is inserted, inside the opening tag. */
  readonly insertAt: number;
  /** The binding path, as `data-payload-field` must spell it. */
  readonly path: string;
  /** 1-based line, for the report. */
  readonly line: number;
  readonly tag: string;
}

/**
 * A place that looks like an output but was left alone, and why.
 *
 * @beta
 */
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
  /**
   * The paths of each collection and global, one set per entity, exactly as a
   * binding must spell them. Kept apart because one variable holds one
   * document: a path is only bindable on a variable whose hand-bound fields
   * the same entity has.
   */
  readonly entities: readonly ReadonlySet<string>[];
}

/**
 * `<tag attrs>content</tag>` with no element inside it, the closing tag
 * repeating the name. Only lowercase tags: an uppercase one is a component,
 * whose children are its own business. An attribute in braces is read as one
 * unit, two levels deep, so the `>` of `bind<Page>(…)` or of an arrow function
 * does not end the tag.
 */
const ELEMENT =
  /<([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}|[^>"'{])*)>([^<]*)<\/\1\s*>/gu;

/** The whole content is one interpolation, and nothing else. */
const ONLY_INTERPOLATION = /^\s*\{([^{}]*)\}\s*$/u;

/** An interpolation somewhere in the content, which is a different case. */
const ANY_INTERPOLATION = /\{([^{}]*)\}/u;

/** A plain member chain: `page.title`, `data.hero.eyebrow`. Nothing callable, nothing indexed. */
const MEMBER_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/u;

const FIELD_ATTRIBUTE = 'data-payload-field';

/** The path a hand-written attribute names: `="title"`, `='title'` or `={'title'}`. */
const FIELD_LITERAL =
  /\bdata-payload-field\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(["'`])([^"'`]*)\3\s*\})/u;

/**
 * A spread of a binding helper: `{...preview.bind('title')}`,
 * `{...bind<Page>("title")}`, `{...bindByPath((d) => d.title)}`. The path is
 * captured when it is a string literal.
 */
const BINDING_SPREAD =
  /\{\s*\.\.\.\s*(?:[\w$]+\s*\.\s*)*(?:bind|bindByPath)\s*(?:<[^>]*>)?\s*\(\s*(?:(["'`])([^"'`]*)\1)?/u;

/** Any other spread: attributes the scan cannot see, a binding among them or not. */
const ANY_SPREAD = /\{\s*\.\.\./u;

/**
 * Where a template names one array item at a time: a `.map`, `.flatMap` or
 * `.forEach` callback's first parameter, a `for … of` variable, a Svelte
 * `{#each … as item}`. A chain rooted at such a name prints an item, and the
 * item's `title` is not the document's `title`, however alike the paths look.
 * A name bound this way anywhere in the file is treated as an item everywhere:
 * refusing one real field access costs a line in the report, binding an item
 * costs the preview.
 */
const LOOP_VARIABLES: readonly RegExp[] = [
  /\.(?:map|flatMap|forEach)\(\s*(?:async\s+)?\(?\s*([A-Za-z_$][\w$]*)/gu,
  /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/gu,
  /\{#each\s[^}]*?\sas\s+([A-Za-z_$][\w$]*)/gu,
];

function loopVariables(source: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const pattern of LOOP_VARIABLES) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return names;
}

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

function rootOf(chain: string): string {
  return chain.slice(0, chain.indexOf('.'));
}

function describe(expression: string): string {
  const flat = expression.replace(/\s+/gu, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

/**
 * How an element is bound already, or `null`. `path` is the field when the
 * binding spells it as a literal, which is what lets it name its variable.
 */
function bindingOf(attributes: string): { readonly path: string | undefined } | null {
  if (attributes.includes(FIELD_ATTRIBUTE)) {
    const literal = FIELD_LITERAL.exec(attributes);
    return { path: literal?.[1] ?? literal?.[2] ?? literal?.[4] };
  }
  const spread = BINDING_SPREAD.exec(attributes);
  return spread === null ? null : { path: spread[2] };
}

/** What a file says about its variables, read from the bindings written by hand. */
interface FileContext {
  /** Every path the schema has, whichever entity. */
  readonly known: ReadonlySet<string>;
  readonly entities: readonly ReadonlySet<string>[];
  readonly items: ReadonlySet<string>;
  /** A variable whose field is bound by hand, with the paths bound on it. */
  readonly anchors: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Why this interpolation cannot become a binding, in the words of the report. */
function refusalReason(expression: string, file: FileContext): string | undefined {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return 'the element is empty';
  if (!MEMBER_CHAIN.test(trimmed)) {
    return 'not a plain field access — a call, an operator or an index cannot be traced to one field';
  }
  const path = pathOf(trimmed);
  const root = rootOf(trimmed);
  if (file.items.has(root)) {
    return `\`${root}\` is a loop item — a binding names a field of the document, and \`${path}\` there is a different value, or none`;
  }
  if (!file.known.has(path)) {
    return `the schema has no field \`${path}\`; the binding would name something that never arrives`;
  }
  const anchored = file.anchors.get(root);
  if (anchored === undefined) {
    return `this file binds no field of \`${root}\` by hand, so nothing says it holds the previewed document rather than another one — bind one of its fields and the rest can follow`;
  }
  const together = [...anchored, path];
  if (!file.entities.some((entity) => together.every((each) => entity.has(each)))) {
    const bound = [...anchored].map((each) => `\`${each}\``).join(', ');
    return `no single collection or global has \`${path}\` and what this file binds on \`${root}\` (${bound}) — one variable holds one document`;
  }
  return undefined;
}

/**
 * Why this element cannot carry a binding whatever it prints: its attributes
 * decide, before the content is read.
 */
function elementRefusal(attributes: string): string | undefined {
  if (ANY_SPREAD.test(attributes)) {
    return 'the element spreads attributes the scan cannot read, and one of them may already bind it';
  }
  return undefined;
}

/**
 * The variables a file binds by hand: an element bound to `P` whose content
 * is `{v.P}` says that `v` holds the document. A loop item never does — its
 * binding names the field of one item, which is a different statement.
 */
function anchorsOf(
  elements: readonly RegExpMatchArray[],
  items: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const anchors = new Map<string, Set<string>>();
  for (const [, , attributes = '', content = ''] of elements) {
    const path = bindingOf(attributes)?.path;
    const chain = ONLY_INTERPOLATION.exec(content)?.[1]?.trim();
    if (path === undefined || chain === undefined || !MEMBER_CHAIN.test(chain)) continue;
    const root = rootOf(chain);
    if (pathOf(chain) !== path || items.has(root)) continue;
    const paths = anchors.get(root) ?? new Set<string>();
    paths.add(path);
    anchors.set(root, paths);
  }
  return anchors;
}

export function scanTemplate(source: string, options: ScanOptions): ScanResult {
  const candidates: AnnotationCandidate[] = [];
  const refusals: AnnotationRefusal[] = [];
  const items = loopVariables(source);
  const elements = [...source.matchAll(ELEMENT)];
  const file: FileContext = {
    known: new Set(options.entities.flatMap((entity) => [...entity])),
    entities: options.entities,
    items,
    anchors: anchorsOf(elements, items),
  };
  for (const match of elements) {
    const [, tag = '', attributes = '', content = ''] = match;
    const line = lineAt(source, match.index);
    // Bound already, by an attribute or a helper's spread: yours wins, always.
    if (bindingOf(attributes) !== null) continue;
    if (ANY_INTERPOLATION.exec(content) === null) continue;
    const refusedElement = elementRefusal(attributes);
    if (refusedElement !== undefined) {
      refusals.push({ line, reason: refusedElement, expression: describe(content) });
      continue;
    }
    const only = ONLY_INTERPOLATION.exec(content);
    if (only === null) {
      // A value printed beside a label — `Published {page.publishedAt}`. The
      // runtime writes an element's whole text, so a binding here would eat the
      // label; splitting the markup is a decision for whoever wrote it.
      refusals.push({
        line,
        reason:
          'the value is printed beside other content — a binding replaces the whole text, so the markup has to be split first',
        expression: describe(content),
      });
      continue;
    }
    const expression = only[1] ?? '';
    const reason = refusalReason(expression, file);
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

/** The attribute a candidate becomes: what `pll-codegen annotate` writes into a file. */
export function fieldAttribute(candidate: AnnotationCandidate): string {
  return `${FIELD_ATTRIBUTE}="${candidate.path}"`;
}

/**
 * Apply the candidates back-to-front, so every earlier offset still holds.
 *
 * `render` decides what a candidate becomes, because the two callers write
 * different things from the same decision: the codemod writes the attribute
 * into the file a person reads, and the build-time annotator writes a call to
 * the authorization-bound helper. What may be annotated at all is decided in
 * one place — above — and never here.
 */
export function applyAnnotations(
  source: string,
  candidates: readonly AnnotationCandidate[],
  render: (candidate: AnnotationCandidate) => string = fieldAttribute,
): string {
  let out = source;
  for (const candidate of [...candidates].sort((a, b) => b.insertAt - a.insertAt)) {
    out = `${out.slice(0, candidate.insertAt)} ${render(candidate)}${out.slice(candidate.insertAt)}`;
  }
  return out;
}
