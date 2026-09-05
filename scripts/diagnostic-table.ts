/**
 * The diagnostic-code table in docs/troubleshooting.md, rendered from
 * `src/core/diagnostic-codes.ts` and held against it. The source owns a
 * code's meaning; the "what to do" column is prose the source cannot carry,
 * kept in REMEDIES below. `--write` updates the block; `--check` fails on any
 * drift, on a code without a remedy, and on a remedy for a code that no
 * longer exists, so the map cannot rot either way.
 *
 * The remedies live here rather than in a JSON under quality/: that directory
 * holds machine-readable baselines a gate compares numbers against, and this
 * is prose a reader edits next to the code that renders it. A separate file
 * would need its own schema check to enforce the same rule this one enforces
 * by construction.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'src/core/diagnostic-codes.ts');
const DOC = resolve(ROOT, 'docs/troubleshooting.md');
const START = '<!-- diagnostic-codes:start -->';
const END = '<!-- diagnostic-codes:end -->';

export interface DiagnosticEntry {
  /** The constant's name, e.g. `OrphanField`. */
  readonly name: string;
  /** The code, e.g. `LP0201`. */
  readonly code: string;
  /** The JSDoc sentence above the constant, as written. */
  readonly meaning: string;
}

export interface DiagnosticCatalog {
  readonly entries: readonly DiagnosticEntry[];
  /** Codes the source records as reserved and unassigned. */
  readonly reserved: readonly string[];
}

/** What a reader does about each code. The source says what happened; this says what to change. */
export const REMEDIES: Readonly<Record<string, string>> = Object.freeze({
  LP0101:
    'Pass `allowedOrigins` — read `PUBLIC_PAYLOAD_ADMIN_ORIGIN` on the server and hand the value in; the runtime reads no environment variable in the browser. Nothing is accepted until you do.',
  LP0102: 'Any framing site is trusted. Set `allowedOrigins` and serve a `frame-ancestors` CSP.',
  LP0103:
    "The plugin's `compat` range does not include this runtime version, so it was not registered. Upgrade the plugin or the package until the ranges meet.",
  LP0201:
    'Render the binding anchor unconditionally so an edit to an initially empty field has somewhere to land; `data-payload-boundary` keeps a hidden anchor for it.',
  LP0202:
    "The message carries neither a global slug nor a collection slug plus `id`, so owner scoping cannot route it; nothing was applied. Check the admin's live-preview setup for that collection, or turn `scopeBindingsByOwner` off on that page.",
  LP0301:
    'Raise `visibilityGateThreshold` (or set `disableVisibilityGate`), or accept that below-the-fold updates wait for a scroll.',
  LP0401:
    'The attribute (`on*`, `style`, `srcdoc`, `formaction`, `id`, `name`, …) or the value (a `javascript:` or `data:` URL) is refused by design. Bind a different attribute or fix the value; the rules are in [security.md](security.md).',
  LP0402:
    'Move `data-payload-field` to the element that holds the value, or add `data-payload-text` to replace the children anyway.',
  LP0403: 'Add `data-payload-array-template` to the container.',
  LP0404:
    'Give every item a stable `id`; without one items pair by position and an insert re-renders every row after it.',
  LP0405: 'Make the key unique per item; later duplicates pair by position.',
  LP0406:
    'The source generates keys per message, so the morph cannot retain nodes across updates. Key items by a stable field, or accept a re-render per update.',
  LP0407:
    'Only `patch`, `fragment` and `route` exist; fix the `data-payload-strategy` value. The element is left unchanged.',
  LP0501:
    'The reason is one of origin, shape, type, token and is visible with `debug: true`. An origin reason means `allowedOrigins` does not list the sender.',
  LP0502:
    'Your `validateToken` refused the token or threw — a throwing validator fails closed. Check the token the admin sends and the validator.',
  LP0601: 'Your `on(...)` handler threw; the runtime continued. Fix the handler.',
  LP0602: 'Your transform threw; the original value was kept. Fix the transform.',
  LP0603:
    'A renderer threw; that one write was abandoned. A custom renderer must not throw on a value it does not expect.',
  LP0605:
    'The runtime could not start once the document was ready and rolled back; the cause is on the `error` event with context `startup` — usually a browser without `MutationObserver`/`IntersectionObserver`, or a document with no `body` yet.',
  LP0606:
    'Posting the `ready` handshake threw (`error` event, context `ready`); without it the admin never sends the document. Read the attached error: the built-in sender tolerates a malformed origin, so the cause is the host window or a custom `sendReady`.',
  LP0701:
    'If you use an adapter, check its `inject` mode and whether a proxy strips `Sec-Fetch-Dest`. If you start the client yourself, this line is expected.',
  LP0702:
    'Let the adapter manage CSP, or add the admin origin to your own `frame-ancestors`. As an error the served policy does not admit `--admin`: add that origin to `allowedOrigins`.',
  LP0703:
    'Remove `X-Frame-Options` from preview responses; a proxy or a security middleware usually sets it, and no CSP directive overrides it.',
  LP0704:
    'Gate binding emission on an authorized preview context with `createPreviewBindings()`; its suppressed form emits nothing at all.',
  LP0705:
    'Raise `visibilityGateThreshold` if the whole page must stay live, or confirm that deferring below the fold is acceptable here.',
  LP0706:
    'Give every binding an owning `data-payload-owner` ancestor, or leave `scopeBindingsByOwner` off until they all have one.',
  LP0707:
    'Add binding attributes to the markup; `pll-codegen --inventory` lists every field the schema makes addressable.',
  LP0708:
    'Point the audit at a route that renders an HTML document. Redirects are reported, not followed, so probe the final URL; a redirect to a login needs a session the probe cannot supply.',
  LP0709:
    "A runtime row is still at its `defaults: 'v1'` value. Set the option the finding names, or drop `defaults: 'v1'` once the page no longer needs it.",
  LP0710:
    "Correct for `inject: 'always'`. Under `'preview-only'` it means every request counts as intent: check `previewSignals` and `previewQueryParams`.",
  LP0801:
    "Network, timeout or a 5xx from the fragment endpoint; the boundary was patched from the same revision. Check the endpoint's logs and its limits.",
  LP0802:
    'Wrong content type, shape, size or boundary; patched instead. Make sure the request reaches the fragment endpoint itself, not a proxy or an error page.',
  LP0803:
    "401/403 — the page's authorization did not hold for the endpoint; patched instead. The endpoint verifies the same token or session as the page, so it must receive it too (same origin, cookies, query).",
  LP0804: 'It belonged to a superseded revision; nothing was applied. Nothing to do.',
  LP0805:
    'The same revision asked for a second refresh; the guard refused it. Nothing to do; `inspect().route.loopStopped` counts them.',
  LP0806:
    'Configure `fragments: { endpoint }` on the adapter so boundaries render on the server; until then they are patched.',
});

/**
 * Read the frozen record: a `/** … *\/` line followed by `Name: 'LP0nnn',`
 * is an entry, and `// LP0nnn is reserved` marks a code nothing may take.
 * A regular expression is enough because the file is a table by design.
 */
export function parseDiagnosticCodes(source: string): DiagnosticCatalog {
  const entries: DiagnosticEntry[] = [];
  const reserved: string[] = [];
  let meaning: string | undefined;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    const doc = /^\/\*\*\s*(.*?)\s*\*\/$/u.exec(line);
    if (doc !== null) {
      meaning = doc[1] ?? '';
      continue;
    }
    const reservation = /^\/\/\s*(LP0\d{3}) is reserved/u.exec(line);
    if (reservation !== null) {
      reserved.push(reservation[1] ?? '');
      continue;
    }
    const entry = /^(\w+):\s*'(LP0\d{3})',$/u.exec(line);
    if (entry !== null) {
      entries.push({ name: entry[1] ?? '', code: entry[2] ?? '', meaning: meaning ?? '' });
      meaning = undefined;
      continue;
    }
    // Any other line ends the reach of a doc comment; a blank one too.
    meaning = undefined;
  }
  return { entries, reserved };
}

/** A table cell: backslashes first, then pipes, so an escaped pipe cannot be unescaped by a preceding backslash. */
function escapeCell(text: string): string {
  return text.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|');
}

/** The source's terminal period reads as a fragment beside the remedy. */
function cell(text: string): string {
  return escapeCell(text.replace(/\.$/u, ''));
}

export function render(
  catalog: DiagnosticCatalog,
  remedies: Readonly<Record<string, string>>,
): string {
  const rows = [...catalog.entries]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(
      (entry) =>
        `| \`${entry.code}\` | ${cell(entry.meaning)} | ${escapeCell(remedies[entry.code] ?? '')} |`,
    );
  const reserved =
    catalog.reserved.length === 0
      ? []
      : [
          '',
          `Reserved and unassigned: ${catalog.reserved.map((code) => `\`${code}\``).join(', ')}.`,
        ];
  return [
    START,
    '',
    '| Code | Meaning | What to do |',
    '| --- | --- | --- |',
    ...rows,
    ...reserved,
    '',
    END,
  ].join('\n');
}

/** Every code has exactly one meaning and one remedy, and no remedy outlives its code. */
export function validate(
  catalog: DiagnosticCatalog,
  remedies: Readonly<Record<string, string>>,
): readonly string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const entry of catalog.entries) {
    const earlier = seen.get(entry.code);
    if (earlier !== undefined) {
      problems.push(`${entry.code} is assigned twice (${earlier}, ${entry.name})`);
    }
    seen.set(entry.code, entry.name);
    if (catalog.reserved.includes(entry.code)) {
      problems.push(`${entry.code} (${entry.name}) is assigned but the source reserves it`);
    }
    if (entry.meaning === '') {
      problems.push(`${entry.code} (${entry.name}) has no doc comment to render as its meaning`);
    }
    if ((remedies[entry.code] ?? '') === '') {
      problems.push(
        `${entry.code} (${entry.name}) has no "what to do" entry; add one to REMEDIES in scripts/diagnostic-table.ts`,
      );
    }
  }
  for (const code of Object.keys(remedies)) {
    if (!seen.has(code)) {
      problems.push(
        `REMEDIES names ${code}, which src/core/diagnostic-codes.ts does not define; remove it`,
      );
    }
  }
  return problems;
}

// Prettier re-pads table cells after `--write`; compare content, not alignment.
export function normalize(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/\s*\|\s*/gu, '|')
        .replace(/-{3,}/gu, '---')
        .trimEnd(),
    )
    .join('\n');
}

export function replaceBlock(doc: string, block: string): string {
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`docs/troubleshooting.md lacks the ${START} … ${END} markers`);
  }
  return doc.slice(0, start) + block + doc.slice(end + END.length);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: diagnostic-table.ts --write | --check');
  }
  const catalog = parseDiagnosticCodes(await readFile(SOURCE, 'utf8'));
  const problems = [...validate(catalog, REMEDIES)];
  const doc = await readFile(DOC, 'utf8');
  const next = replaceBlock(doc, render(catalog, REMEDIES));
  const same = normalize(next) === normalize(doc);
  if (mode === '--write') {
    if (!same) await writeFile(DOC, next, 'utf8');
    console.log(
      `diagnostic-table: docs/troubleshooting.md ${same ? 'unchanged' : 'updated (run npm run format)'}`,
    );
  } else if (!same) {
    problems.push(
      'docs/troubleshooting.md diagnostic block differs from src/core/diagnostic-codes.ts; run npx tsx scripts/diagnostic-table.ts --write',
    );
  }
  for (const problem of problems) console.error(`FAIL ${problem}`);
  if (problems.length > 0) {
    throw new Error(`diagnostic-table: ${String(problems.length)} problem(s)`);
  }
  if (mode === '--check') {
    console.log(
      `diagnostic-table: docs/troubleshooting.md agrees with src/core/diagnostic-codes.ts (${String(catalog.entries.length)} codes)`,
    );
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
