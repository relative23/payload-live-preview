/**
 * Two steps every native consumer shares: copy a template tree whose files carry a
 * `.fixture` suffix, and put one retained archive into a reviewed lock. The lock keeps
 * every other record byte for byte, because a second `npm install` would re-resolve
 * transitive peers (notably Vite) and the gate would stop measuring the reviewed graph.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ConsumerManifest {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
  allowScripts?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface ConsumerLock {
  packages: Record<
    string,
    {
      version?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
}

export interface ArchiveConsumer {
  manifest: ConsumerManifest;
  lock: ConsumerLock;
  /** The archive's own manifest, as `npm pack` wrote it. */
  packaged: { name: string; version: string };
}

export async function copyFixtureTemplates(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const item of await readdir(source, { withFileTypes: true })) {
    if (item.isDirectory()) {
      await copyFixtureTemplates(join(source, item.name), join(destination, item.name));
    } else {
      await copyFile(
        join(source, item.name),
        join(destination, item.name.replace(/\.fixture$/u, '')),
      );
    }
  }
}

/** Read a reviewed manifest and lock, pin every direct version and swap in the archive. */
export async function deriveArchiveConsumer(
  dependencyRoot: string,
  archive: string,
): Promise<ArchiveConsumer> {
  const manifest = JSON.parse(
    await readFile(join(dependencyRoot, 'package.json'), 'utf8'),
  ) as ConsumerManifest;
  const lock = JSON.parse(
    await readFile(join(dependencyRoot, 'package-lock.json'), 'utf8'),
  ) as ConsumerLock;
  // Replace only the workspace package record with the reviewed archive.
  delete manifest.dependencies['payload-live-preview'];
  delete lock.packages['']!.dependencies!['payload-live-preview'];
  delete lock.packages['node_modules/payload-live-preview'];
  // Preserve the fixture's reviewed, version-specific approvals. In particular
  // Nuxt's locked esbuild needs its approved binary validation install hook.
  manifest.allowScripts ??= {};
  manifest.devDependencies ??= {};
  // Record the exact selected direct versions in the derived manifest too.
  for (const group of ['dependencies', 'devDependencies'] as const) {
    const dependencies = manifest[group] ?? {};
    for (const name of Object.keys(dependencies)) {
      const version = lock.packages[`node_modules/${name}`]?.version;
      assert.ok(version, 'Missing pinned consumer dependency');
      dependencies[name] = version;
      lock.packages['']![group]![name] = version;
    }
  }
  const packed = spawnSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, 'Cannot inspect the retained archive manifest');
  const packageManifest = JSON.parse(packed.stdout) as {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    engines?: Record<string, string>;
    bin?: Record<string, string>;
    license?: string;
  };
  assert.equal(packageManifest.name, 'payload-live-preview');
  const location = `file:${archive}`;
  manifest.dependencies['payload-live-preview'] = location;
  lock.packages['']!.dependencies!['payload-live-preview'] = location;
  lock.packages['node_modules/payload-live-preview'] = {
    version: packageManifest.version,
    resolved: location,
    integrity: `sha512-${createHash('sha512')
      .update(await readFile(archive))
      .digest('base64')}`,
    ...(packageManifest.dependencies ? { dependencies: packageManifest.dependencies } : {}),
    peerDependencies: packageManifest.peerDependencies,
    peerDependenciesMeta: packageManifest.peerDependenciesMeta,
    engines: packageManifest.engines,
    bin: packageManifest.bin,
    license: packageManifest.license,
  };
  return { manifest, lock, packaged: packageManifest };
}
