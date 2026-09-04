/**
 * Allow-list for packed content and reachability checks for every manifest
 * target. Both the tarball and the installed tree are consulted, because a
 * target that only exists in one of them is still broken for consumers.
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { exists, isRecord, ROOT, type JsonRecord } from './package-smoke-support';

const PUBLIC_TOP_LEVEL_FILES = new Set(['LICENSE', 'README.md', 'package.json']);
const PUBLIC_DIST_SUFFIXES = [
  '.js',
  '.cjs',
  '.js.map',
  '.cjs.map',
  '.d.ts',
  '.d.cts',
  '.astro',
] as const;
const ESM_ONLY_ARTIFACT_STEMS = [
  'dist/adapters/astro/index',
  'dist/adapters/astro/middleware-entry',
  'dist/adapters/nextjs/index',
  'dist/adapters/nuxt/index',
  'dist/adapters/sveltekit/index',
  'dist/codegen-astro',
  'dist/codegen-cli',
] as const;
const FORBIDDEN_ESM_ONLY_SUFFIXES = ['.cjs', '.cjs.map', '.d.cts'] as const;

export const CODEGEN_EXPORT_NAMES = new Set(['./codegen', './codegen/astro']);

export async function findPackedContentFailures(
  packedFiles: ReadonlySet<string>,
): Promise<readonly string[]> {
  const failures: string[] = [];

  for (const required of PUBLIC_TOP_LEVEL_FILES) {
    if (!packedFiles.has(required)) failures.push(`missing required package file: ${required}`);
  }
  for (const path of [...packedFiles].sort()) {
    const allowedDistFile =
      path.startsWith('dist/') && PUBLIC_DIST_SUFFIXES.some((suffix) => path.endsWith(suffix));
    if (!PUBLIC_TOP_LEVEL_FILES.has(path) && !allowedDistFile) {
      failures.push(`package content is outside the public allow-list: ${path}`);
    }
  }

  for (const stem of ESM_ONLY_ARTIFACT_STEMS) {
    for (const suffix of FORBIDDEN_ESM_ONLY_SUFFIXES) {
      const path = `${stem}${suffix}`;
      const inDist = await exists(resolve(ROOT, path));
      const inTarball = packedFiles.has(path);
      if (inDist || inTarball) {
        const locations = [inDist ? 'dist' : '', inTarball ? 'tarball' : '']
          .filter((location) => location.length > 0)
          .join(' and ');
        failures.push(`unexported ESM-only CJS artifact in ${locations}: ${path}`);
      }
    }
  }

  return failures;
}

function collectManifestTargets(value: unknown, label: string, targets: Map<string, string>): void {
  if (typeof value === 'string') {
    targets.set(label, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectManifestTargets(entry, `${label}[${String(index)}]`, targets);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectManifestTargets(child, `${label}.${key}`, targets);
  }
}

/** Rejects targets that escape the package root, not just missing files. */
function resolvePackageTarget(packageRoot: string, target: string): string | undefined {
  if (!target.startsWith('./')) return undefined;
  const absolute = resolve(packageRoot, target.slice(2));
  const relativeTarget = relative(packageRoot, absolute);
  if (
    relativeTarget.length === 0 ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    return undefined;
  }
  return absolute;
}

async function findSourceMapFailures(
  label: string,
  target: string,
  absolute: string,
  packedFiles: ReadonlySet<string>,
): Promise<readonly string[]> {
  const mapTarget = `${target}.map`;
  const mapPath = `${absolute}.map`;
  if (!packedFiles.has(mapTarget.slice(2)) || !(await exists(mapPath))) {
    return [`${label} JavaScript target has no packed source map: ${mapTarget}`];
  }
  try {
    const sourceMap: unknown = JSON.parse(await readFile(mapPath, 'utf8'));
    if (
      !isRecord(sourceMap) ||
      sourceMap['version'] !== 3 ||
      sourceMap['file'] !== basename(target) ||
      !Array.isArray(sourceMap['sources']) ||
      sourceMap['sources'].length === 0 ||
      typeof sourceMap['mappings'] !== 'string'
    ) {
      return [`${label} source map is malformed: ${mapTarget}`];
    }
  } catch (error: unknown) {
    return [`${label} source map is not valid JSON: ${String(error)}`];
  }
  return [];
}

export async function findPackedTargetFailures(
  manifestValue: JsonRecord,
  packageRoot: string,
  packedFiles: ReadonlySet<string>,
): Promise<readonly string[]> {
  const failures: string[] = [];
  const targets = new Map<string, string>();
  for (const field of ['main', 'module', 'types'] as const) {
    collectManifestTargets(manifestValue[field], field, targets);
  }
  collectManifestTargets(manifestValue['exports'], 'exports', targets);
  collectManifestTargets(manifestValue['bin'], 'bin', targets);

  const checkedMaps = new Set<string>();
  for (const [label, target] of targets) {
    const absolute = resolvePackageTarget(packageRoot, target);
    if (absolute === undefined) {
      failures.push(`${label} is not a safe package-relative target: ${target}`);
      continue;
    }
    const packedPath = target.slice(2);
    if (!packedFiles.has(packedPath)) {
      failures.push(`${label} target is absent from the tarball: ${target}`);
    }
    if (!(await exists(absolute))) {
      failures.push(`${label} target is absent after install: ${target}`);
      continue;
    }

    if ((target.endsWith('.js') || target.endsWith('.cjs')) && !checkedMaps.has(target)) {
      checkedMaps.add(target);
      failures.push(...(await findSourceMapFailures(label, target, absolute, packedFiles)));
    }
  }

  return failures;
}

export async function findExecutableBinFailures(
  packageRoot: string,
  binTarget: string,
): Promise<readonly string[]> {
  const resolved = resolvePackageTarget(packageRoot, binTarget);
  if (resolved === undefined || process.platform === 'win32') return [];
  const mode = (await stat(resolved)).mode;
  return (mode & 0o111) === 0 ? ['packed pll-codegen target is not executable'] : [];
}
