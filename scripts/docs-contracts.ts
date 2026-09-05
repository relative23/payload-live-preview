/**
 * The documentation says concrete things about the package: which entry to
 * import, which class the renderer emits, which attribute a binding carries,
 * which code a diagnostic reports. Those names are checked here against the
 * source, because prose is the one artefact no other gate reads.
 *
 * This is not a spell checker. It verifies the four kinds of name a reader
 * copies verbatim into their own code, where a wrong one fails silently:
 * a class that matches no element, an attribute that binds nothing, an entry
 * that does not resolve, a diagnostic code that leads nowhere.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync } from 'node:fs';
import { INLINE_BUDGET } from './bundle-budgets';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/** Local planning notes, not published with the package. */
const EXCLUDED_DOCS = new Set(['PRIVATE-ROADMAP-TO-2.0.md']);

export interface DocReference {
  readonly kind: 'entry' | 'diagnostic' | 'class' | 'attribute';
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

/** `<slug>`, `*`, `N` and friends stand for a value the reader supplies. */
function isPlaceholder(segment: string): boolean {
  return segment === '' || segment === '*' || /^[<{]/u.test(segment) || /^[A-Z]$/u.test(segment);
}

/**
 * A documented name matches when the source emits it, or emits a prefix it
 * extends: the renderer composes `lp-block--<slug>` from a `lp-block` base, so
 * the literal never appears whole.
 */
export function isKnownName(name: string, known: ReadonlySet<string>): boolean {
  if (known.has(name)) return true;
  for (const separator of ['--', '-']) {
    let index = name.lastIndexOf(separator);
    while (index > 0) {
      const base = name.slice(0, index);
      const rest = name.slice(index + separator.length);
      if (known.has(base) && (isPlaceholder(rest) || /^[a-z0-9]+$/u.test(rest))) return true;
      index = name.lastIndexOf(separator, index - 1);
    }
  }
  return false;
}

export function referencesIn(text: string, file: string): DocReference[] {
  const found: DocReference[] = [];
  text.split('\n').forEach((line, index) => {
    const at = (kind: DocReference['kind'], name: string, index_: number): void => {
      // Inside a URL the package name is a repository path, not a specifier.
      const before = line.slice(0, index_);
      if (kind === 'entry' && /https?:\/\/\S*$/u.test(before)) return;
      found.push({ kind, name, file, line: index + 1 });
    };
    for (const m of line.matchAll(/\bpayload-live-preview(\/[A-Za-z0-9/.-]+)?/gu)) {
      at('entry', m[0], m.index);
    }
    for (const m of line.matchAll(/\bLP0\d{3}\b/gu)) at('diagnostic', m[0], m.index);
    for (const m of line.matchAll(/(?<![\w-])lp-[a-z0-9-]*[a-z0-9<>*{}]/gu)) {
      at('class', m[0], m.index);
    }
    for (const m of line.matchAll(/(?<![\w-])data-payload-[a-z-]*[a-z]/gu)) {
      at('attribute', m[0], m.index);
    }
  });
  return found;
}

async function sourceLiterals(pattern: RegExp): Promise<Set<string>> {
  const names = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.generated.ts')) {
        for (const m of (await readFile(full, 'utf8')).matchAll(pattern)) names.add(m[0]);
      }
    }
  };
  await walk(resolve(ROOT, 'src'));
  return names;
}

async function docFiles(): Promise<string[]> {
  const files = [resolve(ROOT, 'README.md')];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.md') && !EXCLUDED_DOCS.has(entry.name)) files.push(full);
    }
  };
  await walk(resolve(ROOT, 'docs'));
  return files;
}

/**
 * Entry points whose options carry a `serverURL`. Under the 2.0 defaults that
 * option requires an explicit `mergeDepth`, so a snippet showing one without
 * the other documents a setup that throws on first build. Every framework
 * quickstart did exactly that until this rule existed, because no fixture
 * passes `serverURL` and nothing else reads the snippets.
 *
 * `authorizePreviewRequest` also takes a `serverURL` — the Payload server a
 * session is checked against, unrelated to the REST merge — so a block using it
 * is left alone.
 */
const SETUP_CALLS = [
  'livePreview(',
  'createLivePreviewMiddleware(',
  'generateInlineScript(',
  'livePreviewHandle(',
  'livePreviewNitroPlugin(',
  'defineLivePreviewServerHandler(',
] as const;

export function setupSnippetViolations(text: string, file: string): string[] {
  const violations: string[] = [];
  const blocks = text.matchAll(/```[a-z]*\n([\s\S]*?)```/gu);
  for (const block of blocks) {
    const body = block[1] ?? '';
    if (!SETUP_CALLS.some((call) => body.includes(call))) continue;
    if (!body.includes('serverURL')) continue;
    if (body.includes('authorizePreviewRequest(')) continue;
    if (body.includes('mergeDepth') || body.includes('defaults:')) continue;
    const line = text.slice(0, block.index).split('\n').length;
    violations.push(
      `${file}:${String(line)} setup snippet passes serverURL without mergeDepth or defaults`,
    );
  }
  return violations;
}

/** GitHub's heading slugs: lower case, punctuation dropped, spaces to hyphens; fenced code is not a heading. */
export function headingSlugs(text: string): Set<string> {
  const slugs = new Set<string>();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading === null) continue;
    const slug = (heading[1] ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/gu, '-');
    slugs.add(slug);
  }
  return slugs;
}

/**
 * Relative links between pages, with their heading anchors. A restructuring
 * moves sections between files, and a link to a page or heading that no longer
 * exists fails only for the reader who follows it. External URLs are not
 * fetched; a link inside a code fence is a snippet, not a link.
 */
export function brokenLinks(
  text: string,
  file: string,
  target: (path: string) => string | undefined,
): string[] {
  const violations: string[] = [];
  const prose = text.replace(/```[\s\S]*?```/gu, (block) => block.replace(/[^\n]/gu, ' '));
  const links = [
    ...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu),
    ...prose.matchAll(/^\[[^\]]+\]:\s*(\S+)/gmu),
  ];
  for (const link of links) {
    const raw = link[1] ?? '';
    if (/^[a-z][a-z0-9+.-]*:/iu.test(raw)) continue;
    const [path, anchor] = raw.split('#', 2);
    const body = path === '' || path === undefined ? text : target(path);
    const line = prose.slice(0, link.index).split('\n').length;
    if (body === undefined) {
      violations.push(`${file}:${String(line)} link to a file that does not exist: ${raw}`);
      continue;
    }
    if (
      anchor !== undefined &&
      anchor !== '' &&
      !headingSlugs(body).has(decodeURIComponent(anchor))
    ) {
      violations.push(`${file}:${String(line)} link to a heading that does not exist: ${raw}`);
    }
  }
  return violations;
}

/**
 * The README states the runtime's transfer size once. It drifted from 21 KB to
 * 29 KB without anyone noticing, so the claim is held to the release gate's
 * budget within a kilobyte.
 */
export function sizeClaimViolations(text: string, file: string, gzipBudget: number): string[] {
  const claims = [...text.matchAll(/about (\d+) KB gzip/gu)];
  const expected = Math.round(gzipBudget / 1024);
  return claims
    .filter((claim) => Math.abs(Number(claim[1]) - expected) > 1)
    .map((claim) => {
      const line = text.slice(0, claim.index).split('\n').length;
      return `${file}:${String(line)} says about ${claim[1] ?? ''} KB gzip, the budget is ${String(expected)} KB`;
    });
}

/** Resolve a link relative to the page that carries it; a directory counts as a page too. */
function linkTarget(from: string): (path: string) => string | undefined {
  return (path) => {
    const full = resolve(dirname(from), path);
    // One read, no existence check first: the file is the answer, or it is not.
    try {
      return statSync(full).isDirectory() ? '' : readFileSync(full, 'utf8');
    } catch {
      return undefined;
    }
  };
}

async function main(): Promise<void> {
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  const entries = new Set(
    Object.keys(pkg.exports).map((key) =>
      key === '.' ? 'payload-live-preview' : `payload-live-preview${key.slice(1)}`,
    ),
  );
  // Assigned codes plus the ones the source records as deliberately reserved:
  // the docs name a reserved code, and nothing else may quietly take it.
  const codeSource = await readFile(resolve(ROOT, 'src/core/diagnostic-codes.ts'), 'utf8');
  const codes = new Set([
    ...[...codeSource.matchAll(/'(LP0\d{3})'/gu)].map((x) => x[1]!),
    ...[...codeSource.matchAll(/\b(LP0\d{3}) is reserved/gu)].map((x) => x[1]!),
  ]);
  const classes = await sourceLiterals(/(?<![\w-])lp-[a-z0-9-]*[a-z0-9]/gu);
  const attributes = await sourceLiterals(/(?<![\w-])data-payload-[a-z-]*[a-z]/gu);
  const known: Record<DocReference['kind'], ReadonlySet<string>> = {
    entry: entries,
    diagnostic: codes,
    class: classes,
    attribute: attributes,
  };

  const violations: string[] = [];
  const files = await docFiles();
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const name = relative(ROOT, file);
    for (const ref of referencesIn(text, name)) {
      if (isKnownName(ref.name, known[ref.kind])) continue;
      violations.push(`${ref.file}:${String(ref.line)} unknown ${ref.kind} "${ref.name}"`);
    }
    violations.push(...setupSnippetViolations(text, name));
    violations.push(...brokenLinks(text, name, linkTarget(file)));
    if (name === 'README.md') {
      violations.push(...sizeClaimViolations(text, name, INLINE_BUDGET.gzip));
    }
  }
  for (const extra of ['CONTRIBUTING.md', 'examples/README.md', 'tests/README.md']) {
    const file = resolve(ROOT, extra);
    violations.push(...brokenLinks(await readFile(file, 'utf8'), extra, linkTarget(file)));
  }

  if (violations.length > 0) {
    throw new Error(
      `documentation contracts failed:\n${[...new Set(violations)].map((v) => `- ${v}`).join('\n')}`,
    );
  }
  console.log(
    `Documentation contracts passed: ${String(entries.size)} entries, ${String(codes.size)} diagnostics, ` +
      `${String(classes.size)} classes and ${String(attributes.size)} attributes are named as the source defines them.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
