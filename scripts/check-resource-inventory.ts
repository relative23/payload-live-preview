/**
 * Every place the runtime's core acquires something that outlives the call —
 * a timer, a listener, an observer, an abort controller, a property on a
 * global — and who releases it. A session's resources are owned by its scope
 * (`src/core/resource-scope.ts`, opened by `start()` and closed by
 * `destroy()`, `suspend()` and a failed start alike); the rest are named
 * here with the hand that lets them go. A new acquisition, or a moved one,
 * fails the architecture gate until it is written down.
 *
 * Keys are `<module>::<line>`, the line trimmed, as the scan reads them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCOPE_DIRECTORY = join(ROOT, 'src', 'core');
const INVENTORY = join(ROOT, 'quality', 'resource-inventory.json');

const ACQUISITIONS: readonly RegExp[] = [
  /\bsetTimeout\(/u,
  /\bsetInterval\(/u,
  /\.addEventListener\(/u,
  /\bnew MutationObserver\(/u,
  /\bnew IntersectionObserver\(/u,
  /\bnew AbortController\(/u,
  /\bObject\.defineProperty\(/u,
  /\brequestAnimationFrame\(/u,
];

/** Who releases the resource. */
type Release =
  /** The session scope: closed by `destroy()`, `suspend()` and a failed start. */
  | 'scope'
  /** The instance, on `destroy()` only; a suspended runtime keeps it. */
  | 'instance'
  /** The disposer the acquiring call returns; its caller lets it go. */
  | 'caller'
  /** A page-wide accessor installed once and left in place on purpose. */
  | 'global';

interface Entry {
  readonly release: Release;
  readonly why: string;
}

interface Inventory {
  readonly schemaVersion: number;
  readonly sites: Readonly<Record<string, Entry>>;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.generated.ts')) files.push(path);
  }
  return files.sort();
}

export function scanAcquisitions(directory = SCOPE_DIRECTORY): string[] {
  const keys: string[] = [];
  for (const file of sourceFiles(directory)) {
    const module = relative(ROOT, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (ACQUISITIONS.some((pattern) => pattern.test(trimmed))) keys.push(`${module}::${trimmed}`);
    }
  }
  return keys;
}

function main(): void {
  const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')) as Inventory;
  const listed = new Set(Object.keys(inventory.sites));
  const found = scanAcquisitions();
  const problems: string[] = [];
  for (const key of found) {
    if (!listed.has(key)) problems.push(`unlisted acquisition: ${key}`);
  }
  const foundSet = new Set(found);
  for (const key of listed) {
    if (!foundSet.has(key)) problems.push(`stale entry, no such line: ${key}`);
  }
  for (const [key, entry] of Object.entries(inventory.sites)) {
    if (!['scope', 'instance', 'caller', 'global'].includes(entry.release)) {
      problems.push(`${key}: release must name who lets it go`);
    }
    if (typeof entry.why !== 'string' || entry.why.length < 20) {
      problems.push(`${key}: say why in a sentence`);
    }
  }
  if (problems.length > 0) {
    console.error('resource inventory:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      'Add the site to quality/resource-inventory.json with who releases it, or remove the stale entry.',
    );
    process.exit(1);
  }
  const byRelease = new Map<string, number>();
  for (const entry of Object.values(inventory.sites)) {
    byRelease.set(entry.release, (byRelease.get(entry.release) ?? 0) + 1);
  }
  const summary = [...byRelease]
    .map(([release, count]) => `${String(count)} ${release}`)
    .join(', ');
  console.log(
    `Resource inventory passed: ${String(found.length)} acquisitions in src/core, every one released by name (${summary}).`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
