/**
 * The exact Astro 4 peer floor is a static production consumer of one retained archive.
 * It installs the reviewed lock with only the archive record replaced, proves the semantic
 * checker rejects a template that transpilation alone accepts, builds a delivery mode on
 * request and serves the output on loopback. The parent page is a mock: this gate proves
 * framework delivery and DOM behavior at the floor, not a real admin.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { probeUnavailableDependencies } from '../../../scripts/package-smoke-consumer';
import {
  PACKAGE_SMOKE_INSTALL_ARGS,
  findPackageSmokeIsolationViolations,
  sanitizeNpmScriptEnvironment,
} from '../../../scripts/release-contracts';
import { copyFixtureTemplates, deriveArchiveConsumer } from './native-consumer';

/** The floor is the lower bound of the `astro` peer range; a unit test holds the two together. */
export const ASTRO_FLOOR_VERSION = '4.0.0';
/** Loopback port of the static site; the Playwright config names the same one. */
export const ASTRO_FLOOR_PORT = 4290;
const ORIGIN = `http://localhost:${String(ASTRO_FLOOR_PORT)}`;
const DEPENDENCY_ROOT = 'tests/fixtures/astro-floor-base-deps';
const TEMPLATE_ROOT = 'tests/fixtures/astro-floor-base';

export type FloorDelivery = 'inline' | 'loader';
/** A control builds the same page without one capability the spec's assertions depend on. */
export type FloorControl = 'none' | 'no-integration' | 'wrong-origin';

export interface AstroFloorSite {
  readonly origin: string;
  close(): Promise<void>;
}

export interface AstroFloorBase {
  /** Build one variant of the page from the installed consumer and serve it on the floor port. */
  serve(delivery: FloorDelivery, control?: FloorControl): Promise<AstroFloorSite>;
  close(): Promise<void>;
}

const checksum = (value: Uint8Array | string): string =>
  createHash('sha256').update(value).digest('hex');

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Only files inside the build are served; there is no fallback to the workspace. */
async function serveDirectory(root: string): Promise<AstroFloorSite> {
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      try {
        const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
        let file = resolve(root, '.' + path);
        if (file !== root && !file.startsWith(root + sep)) throw new Error('Outside the build');
        if (path.endsWith('/')) file = resolve(file, 'index.html');
        const type = Object.entries(TYPES).find(([extension]) => file.endsWith(extension));
        const body = await readFile(file);
        response.writeHead(200, { 'content-type': type?.[1] ?? 'application/octet-stream' });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end('Not found');
      }
    })();
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(ASTRO_FLOOR_PORT, '127.0.0.1', accept);
  });
  let closed: Promise<void> | undefined;
  return {
    origin: ORIGIN,
    close: () =>
      (closed ??= new Promise<void>((accept) => {
        server.close(() => accept());
        server.closeAllConnections();
      })),
  };
}

async function hashTree(root: string, directory = ''): Promise<Record<string, string>> {
  const rows: Record<string, string> = {};
  for (const item of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory === '' ? item.name : `${directory}/${item.name}`;
    if (item.isDirectory()) Object.assign(rows, await hashTree(root, path));
    else rows[path] = checksum(await readFile(join(root, path)));
  }
  return rows;
}

export async function prepareAstroFloorBase(artifact: string): Promise<AstroFloorBase> {
  const tarball = process.env['PLP_CONTINUATION_TARBALL'];
  assert.ok(tarball, 'PLP_CONTINUATION_TARBALL must name the retained archive');
  const root = process.cwd();
  const archive = resolve(tarball);
  const directory = await mkdtemp(join(tmpdir(), 'plp-astro-floor-'));
  const app = join(directory, 'app');
  const logs: string[] = [];
  const environment = {
    ...sanitizeNpmScriptEnvironment(process.env),
    ASTRO_TELEMETRY_DISABLED: '1',
  };
  /** The page's config reads its delivery, control and origin from the environment of every npm script. */
  const configured = (delivery: FloorDelivery, control: FloorControl): NodeJS.ProcessEnv => ({
    ...environment,
    PLP_ASTRO_FLOOR_DELIVERY: delivery,
    PLP_ASTRO_FLOOR_CONTROL: control,
    PLP_ASTRO_FLOOR_ORIGIN: ORIGIN,
  });
  const npm = (
    args: string[],
    env: NodeJS.ProcessEnv = environment,
  ): { status: number | null; output: string } => {
    const result = spawnSync('npm', args, { cwd: app, env, encoding: 'utf8', timeout: 180_000 });
    logs.push(`npm ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return { status: result.status, output: stripVTControlCharacters(result.stdout) };
  };
  let site: AstroFloorSite | undefined;
  const close = async (): Promise<void> => {
    await site?.close();
    site = undefined;
    await mkdir(artifact, { recursive: true });
    await writeFile(join(artifact, 'setup.log'), logs.join('\n'));
    await rm(directory, { recursive: true, force: true });
  };
  try {
    assert.deepEqual(findPackageSmokeIsolationViolations(root, directory), []);
    await mkdir(app);
    const dependencyRoot = resolve(root, DEPENDENCY_ROOT);
    const consumer = await deriveArchiveConsumer(dependencyRoot, archive);
    await writeFile(join(app, 'package.json'), JSON.stringify(consumer.manifest));
    await writeFile(join(app, 'package-lock.json'), JSON.stringify(consumer.lock));
    await copyFile(join(dependencyRoot, '.npmrc'), join(app, '.npmrc'));
    // Online on a cold runner: the lock's integrity hashes pin every byte either way.
    const install = [
      ...PACKAGE_SMOKE_INSTALL_ARGS.filter(
        (arg) =>
          !['--omit=optional', '--offline', '--package-lock=false', '--no-save'].includes(arg),
      ),
      '--prefer-offline',
    ];
    assert.equal(npm(['ci', ...install]).status, 0, 'Isolated dependency install failed');
    const probe = probeUnavailableDependencies(app, [
      'react',
      'react-dom',
      'vue',
      'svelte',
      'nuxt',
      'next',
      '@sveltejs/kit',
      'payload',
    ]);
    logs.push(`Peer-free resolution probe\n${probe.stdout}\n${probe.stderr}`);
    assert.equal(probe.status, 0, 'The floor consumer resolved a framework or CMS it does not use');
    const versions: Record<string, string> = {};
    for (const name of ['astro', 'vite', '@astrojs/check', 'typescript', 'payload-live-preview']) {
      assert.ok(
        (await realpath(join(app, 'node_modules', name))).startsWith(`${app}/node_modules/`),
        `Consumer ${name} escaped isolation`,
      );
      versions[name] = (
        JSON.parse(await readFile(join(app, 'node_modules', name, 'package.json'), 'utf8')) as {
          version: string;
        }
      ).version;
      if (name !== 'payload-live-preview') {
        assert.equal(versions[name], consumer.lock.packages[`node_modules/${name}`]?.version);
      }
    }
    assert.equal(versions['astro'], ASTRO_FLOOR_VERSION, 'The consumer is not on the floor');
    assert.equal(versions['payload-live-preview'], consumer.packaged.version);
    await copyFixtureTemplates(resolve(root, TEMPLATE_ROOT), app);
    // The semantic checker must reject what transpilation alone accepts, or a green
    // build proves nothing about the shipped .astro components' types at this floor.
    const counterexample = join(app, 'src/components/__typecheck_counterexample.astro');
    await mkdir(join(app, 'src/components'), { recursive: true });
    await copyFile(join(app, 'type-contracts/Negative.astro'), counterexample);
    const negative = npm(['run', 'typecheck'], configured('loader', 'none'));
    await unlink(counterexample);
    assert.equal(negative.status, 1, 'The semantic counterexample must fail');
    assert.ok(negative.output.includes('__typecheck_counterexample.astro'));
    assert.ok(negative.output.includes("Property 'toFixed' does not exist on type 'string'"));
    assert.ok(negative.output.includes('error ts(2551)'));
    assert.equal((negative.output.match(/error ts\(/gu) ?? []).length, 1);
    await mkdir(artifact, { recursive: true });
    await writeFile(
      join(artifact, 'identity.json'),
      JSON.stringify(
        {
          versions,
          tarballSHA256: checksum(await readFile(archive)),
          lockSHA256: checksum(JSON.stringify(consumer.lock)),
          semanticCounterexample: 'TS2551',
        },
        null,
        2,
      ),
    );
    const built = new Set<string>();
    return {
      async serve(delivery, control = 'none') {
        const key = `${delivery}-${control}`;
        const output = join(directory, 'builds', key);
        if (!built.has(key)) {
          const build = npm(['run', 'build'], configured(delivery, control));
          assert.equal(build.status, 0, `The ${key} production build failed; see the setup log`);
          await mkdir(join(directory, 'builds'), { recursive: true });
          await rename(join(app, 'dist'), output);
          built.add(key);
          await writeFile(
            join(artifact, `build-${key}.json`),
            JSON.stringify(await hashTree(output), null, 2),
          );
        }
        await site?.close();
        site = await serveDirectory(output);
        return site;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
