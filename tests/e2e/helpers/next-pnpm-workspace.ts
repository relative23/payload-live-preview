/**
 * A pnpm workspace in which the package cannot reach a Next.js app's `next` through Node. Hoisting
 * is off and the workspace root depends on a copy of `next` of its own, the one Node finds from the
 * package; two sites, on Next.js 15.5 and 16, install the retained archive from a reviewed lock and
 * render `<LivePreviewNavigation />`. The package declares no `next` peer, so the entry works here
 * only because Next.js resolves `next` for every module it bundles to the app's own installation.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseAllDocuments } from 'yaml';
import {
  findPackageSmokeIsolationViolations,
  sanitizeNpmScriptEnvironment,
} from '../../../scripts/release-contracts';
import { copyFixtureTemplates } from './native-consumer';

/** Loopback port of the one site being served; the Playwright config names the same one. */
export const NEXT_PNPM_WORKSPACE_PORT = 4294;
const ORIGIN = `http://localhost:${String(NEXT_PNPM_WORKSPACE_PORT)}`;
const WORKSPACE_ROOT = 'tests/fixtures/next-pnpm-workspace';
const TOOL_ROOT = 'tests/fixtures/next-pnpm-workspace-tool';
/**
 * A dist-tag of `next`, set by the Latest Watch: the Next.js 16 site then installs that channel and
 * the newest React, and pnpm resolves those over the reviewed lock.
 */
const NEXT_PNPM_CHANNEL = 'PLP_NEXT_PNPM_CHANNEL';

export type WorkspaceSite = 'next-15' | 'next-16';
const SITES: readonly WorkspaceSite[] = ['next-15', 'next-16'];
export interface WorkspaceRun {
  readonly site: WorkspaceSite;
  readonly command: 'build' | 'dev';
  readonly bundler: 'turbopack' | 'webpack';
}

/** Next.js 16 builds and develops with Turbopack unless told `--webpack`, Next.js 15 with webpack. */
const defaultBundler = (major: number): WorkspaceRun['bundler'] =>
  major < 16 ? 'webpack' : 'turbopack';

export interface ServedSite {
  readonly origin: string;
  close(): Promise<void>;
}

export interface NextPnpmWorkspace {
  /**
   * Build and start, or start in development, one site with one bundler. The control build hands the
   * package's `next/navigation` import the copy Node finds from the package.
   */
  serve(run: WorkspaceRun, control?: boolean): Promise<ServedSite>;
  close(): Promise<void>;
}

interface Lock {
  importers: Record<string, { dependencies?: Record<string, unknown> }>;
  packages?: Record<string, unknown>;
  snapshots?: Record<string, unknown>;
}

/** pnpm writes a lock as one YAML document, or two when it also records itself. */
function readLock(text: string): Lock {
  const documents = parseAllDocuments(text);
  const last = Array.isArray(documents) ? documents.at(-1) : undefined;
  assert.ok(last, 'The pnpm lock holds no document');
  return last.toJS() as Lock;
}

/** The lock without what the archive decides: its own records and each importer's resolution of it. */
function withoutArchive(lock: Lock): Lock {
  const keep = (records: Record<string, unknown> | undefined): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(records ?? {}).filter(([key]) => !key.startsWith('payload-live-preview@')),
    );
  return {
    importers: Object.fromEntries(
      Object.entries(lock.importers).map(([name, importer]) => {
        const dependencies = { ...importer.dependencies };
        delete dependencies['payload-live-preview'];
        return [name, { ...importer, dependencies }];
      }),
    ),
    packages: keep(lock.packages),
    snapshots: keep(lock.snapshots),
  };
}

export async function prepareNextPnpmWorkspace(artifact: string): Promise<NextPnpmWorkspace> {
  const tarball = process.env['PLP_CONTINUATION_TARBALL'];
  assert.ok(tarball, 'PLP_CONTINUATION_TARBALL must name the retained archive');
  const channel = process.env[NEXT_PNPM_CHANNEL];
  const root = process.cwd();
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'plp-next-pnpm-')));
  const tool = join(directory, 'tool');
  const workspace = join(directory, 'workspace');
  const logs: string[] = [];
  const environment: NodeJS.ProcessEnv = {
    ...sanitizeNpmScriptEnvironment(process.env),
    NEXT_TELEMETRY_DISABLED: '1',
  };
  // `next build` and `next dev` choose their own mode; an inherited one would override it.
  delete environment['NODE_ENV'];
  const run = (args: readonly string[], cwd: string): number | null => {
    const [program = '', ...rest] = args;
    const result = spawnSync(program, rest, {
      cwd,
      env: environment,
      encoding: 'utf8',
      timeout: 600_000,
    });
    logs.push(`${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result.status;
  };
  let served: ServedSite | undefined;
  const close = async (): Promise<void> => {
    await served?.close();
    served = undefined;
    await mkdir(artifact, { recursive: true });
    await writeFile(join(artifact, 'setup.log'), logs.join('\n'));
    await rm(directory, { recursive: true, force: true });
  };
  const versions: Partial<Record<WorkspaceSite, string>> = {};
  try {
    assert.deepEqual(findPackageSmokeIsolationViolations(root, directory), []);
    // pnpm comes from a reviewed lock too, with its native linux binary; no lifecycle script runs,
    // and its entry finds the installed binary instead of downloading one.
    await mkdir(tool);
    for (const file of ['package.json', 'package-lock.json']) {
      await copyFile(resolve(root, TOOL_ROOT, file), join(tool, file));
    }
    const installTool = [
      'npm',
      'ci',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefer-offline',
    ];
    assert.equal(run(installTool, tool), 0, 'Installing pnpm failed; see setup log');
    const pnpm = [process.execPath, join(tool, 'node_modules/pnpm/bin/pnpm.mjs')];

    await mkdir(workspace);
    const files = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'];
    for (const file of files) {
      await copyFile(resolve(root, WORKSPACE_ROOT, file), join(workspace, file));
    }
    for (const site of SITES) {
      await mkdir(join(workspace, site));
      await copyFile(
        resolve(root, WORKSPACE_ROOT, site, 'package.json'),
        join(workspace, site, 'package.json'),
      );
      await copyFixtureTemplates(
        resolve(root, WORKSPACE_ROOT, 'app'),
        join(workspace, site, 'app'),
      );
    }
    await copyFile(resolve(tarball), join(workspace, 'payload-live-preview.tgz'));
    const reviewed = readLock(await readFile(join(workspace, 'pnpm-lock.yaml'), 'utf8'));
    if (channel !== undefined) {
      // pnpm holds back a version younger than a day by default, and a channel's newest one usually is.
      const settings = join(workspace, 'pnpm-workspace.yaml');
      await writeFile(settings, `${await readFile(settings, 'utf8')}minimumReleaseAge: 0\n`);
      const manifestPath = join(workspace, 'next-16', 'package.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        dependencies: Record<string, string>;
      };
      Object.assign(manifest.dependencies, {
        next: channel,
        react: 'latest',
        'react-dom': 'latest',
      });
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
    // The archive's bytes differ from the reviewed lock's with every build, so the lock cannot be
    // installed frozen; pnpm resolves only what moved, and the comparison below holds the rest. On a
    // channel the Next.js 16 site moves too, and the root and the Next.js 15 site must not.
    const install = ['install', '--no-frozen-lockfile', '--ignore-scripts', '--prefer-offline'];
    assert.equal(
      run([...pnpm, ...install, '--reporter=append-only'], workspace),
      0,
      'pnpm install failed; see setup log',
    );
    const installed = withoutArchive(
      readLock(await readFile(join(workspace, 'pnpm-lock.yaml'), 'utf8')),
    );
    const expected = withoutArchive(reviewed);
    if (channel === undefined) {
      assert.deepEqual(installed, expected, 'pnpm moved a reviewed package');
    }
    for (const importer of ['.', 'next-15']) {
      assert.deepEqual(
        installed.importers[importer],
        expected.importers[importer],
        `pnpm moved what ${importer} installs`,
      );
    }

    const nodeFinds = await realpath(join(workspace, 'node_modules/next'));
    for (const site of SITES) {
      const own = await realpath(join(workspace, site, 'node_modules/next'));
      const packageDirectory = await realpath(
        join(workspace, site, 'node_modules/payload-live-preview'),
      );
      const found = dirname(
        createRequire(join(packageDirectory, 'package.json')).resolve('next/package.json'),
      );
      // With a `next` peer pnpm links the site's own copy beside the package, and the runs below
      // would pass through Node's resolution instead of the bundler's.
      assert.notEqual(
        found,
        own,
        `${site}: Node finds the site's own next from the package; does the archive declare a next peer?`,
      );
      assert.equal(found, nodeFinds, `${site}: Node does not find the workspace root's next`);
      const { version } = JSON.parse(await readFile(join(own, 'package.json'), 'utf8')) as {
        version: string;
      };
      versions[site] = version;
    }
    logs.push(
      `next per site: ${JSON.stringify(versions)}; Node finds ${nodeFinds} from the package`,
    );
  } catch (error) {
    await close();
    throw error;
  }

  const serve = async (target: WorkspaceRun, control = false): Promise<ServedSite> => {
    await served?.close();
    const site = join(workspace, target.site);
    const major = Number(versions[target.site]?.split('.')[0]);
    const flags = defaultBundler(major) === target.bundler ? [] : [`--${target.bundler}`];
    const next = [process.execPath, join(site, 'node_modules/next/dist/bin/next')];
    const config = join(site, 'next.config.mjs');
    await rm(join(site, '.next'), { recursive: true, force: true });
    if (control) {
      await copyFile(resolve(root, WORKSPACE_ROOT, 'next.config.control.mjs.fixture'), config);
    } else {
      await rm(config, { force: true });
    }
    if (target.command === 'build') {
      assert.equal(
        run([...next, 'build', ...flags], site),
        0,
        `next build ${flags.join(' ')} failed; see setup log`,
      );
    }
    const port = String(NEXT_PNPM_WORKSPACE_PORT);
    const args = target.command === 'build' ? ['start', '-p', port] : ['dev', ...flags, '-p', port];
    const [program = '', ...rest] = [...next, ...args];
    // Its own process group: `next dev` starts workers that must stop with it.
    const child = spawn(program, rest, {
      cwd: site,
      env: environment,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    child.stdout.on('data', (data) => output.push(String(data)));
    child.stderr.on('data', (data) => output.push(String(data)));
    const exited = new Promise<void>((accept) => child.once('exit', () => accept()));
    const signal = (name: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, name);
      } catch {
        // The group has already gone.
      }
    };
    let closed: Promise<void> | undefined;
    const stop = (): Promise<void> =>
      (closed ??= (async () => {
        if (child.exitCode === null && child.signalCode === null) {
          signal('SIGTERM');
          const timer = setTimeout(() => signal('SIGKILL'), 10_000);
          await exited;
          clearTimeout(timer);
        }
        logs.push(`next ${args.join(' ')} (${target.site})\n${output.join('')}`);
        served = undefined;
      })());
    const current = { origin: ORIGIN, close: stop };
    served = current;
    // A development server compiles the page on this first request.
    const deadline = Date.now() + 180_000;
    for (;;) {
      const status = await fetch(`${ORIGIN}/`).then(
        (response) => response.status,
        () => 0,
      );
      if (status === 200) break;
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        await stop();
        assert.fail(`next ${args.join(' ')} did not serve ${ORIGIN}/; see setup log`);
      }
      await new Promise((accept) => setTimeout(accept, 500));
    }
    return current;
  };

  return { serve, close };
}
