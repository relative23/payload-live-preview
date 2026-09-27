/**
 * Fresh framework and Payload installations for the continuation browser contract.
 * The existing TLS production runner builds the copied application. Only the
 * explicit retained archive supplies package code; local references are bundled
 * with their package imports external, never with workspace runtime sources.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type * as ServerEntry from '../../../src/server/index';
import type { ACLFixture } from '../../fixtures/payload-acl-reference';
import {
  PACKAGE_SMOKE_INSTALL_ARGS,
  PACKAGE_SMOKE_NPMRC,
  findPackageSmokeIsolationViolations,
  sanitizeNpmScriptEnvironment,
} from '../../../scripts/release-contracts';
import { probeUnavailableDependencies } from '../../../scripts/package-smoke-consumer';
import {
  checkAstroBridgeRuntime,
  checkAstroResourceTemplates,
  recordAstroResources,
} from './astro-resources';
import {
  astroResourceRenderer,
  astroResourceVersion,
  prepareAstroResourceVersion,
} from './astro-resource-versions';

const ROOT = process.cwd();
interface NativeACLFixture extends ACLFixture {
  policyChanges(): number;
  setRelatedReadAccess(collection: 'records' | 'media', id: number, allowed: boolean): void;
}
type StartACLFixture = (options: { versionedRelated: boolean }) => Promise<NativeACLFixture>;
const checksum = (value: Uint8Array | string): string =>
  createHash('sha256').update(value).digest('hex');
async function templates(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const item of await readdir(source, { withFileTypes: true })) {
    if (item.isDirectory()) await templates(join(source, item.name), join(destination, item.name));
    else {
      await copyFile(
        join(source, item.name),
        join(destination, item.name.replace(/\.fixture$/u, '')),
      );
    }
  }
}

export async function startNativeContinuation(
  artifact: string,
  framework: 'next' | 'sveltekit' | 'nuxt' | 'astro' | 'html' | 'vue',
  baseline = false,
  profile: 'continuation' | 'astro-resources' = 'continuation',
) {
  const isNext = framework === 'next';
  const isNuxt = framework === 'nuxt';
  const isAstro = framework === 'astro';
  const isHTML = framework === 'html';
  const isVue = framework === 'vue';
  const isAstroResources = profile === 'astro-resources';
  assert.ok(!isAstroResources || isAstro, 'The resource profile requires native Astro');
  const resourceVersion = isAstroResources
    ? astroResourceVersion(
        process.env['PLP_ASTRO_RESOURCE_VERSION'],
        process.env['PLP_ASTRO_RESOURCE_RENDERER'],
      )
    : undefined;
  const resourceRenderer = resourceVersion
    ? astroResourceRenderer(resourceVersion.version, process.env['PLP_ASTRO_RESOURCE_RENDERER'])
    : undefined;
  const isAstroReact =
    resourceRenderer === 'react-server' ||
    resourceRenderer === 'react-unconfigured' ||
    resourceRenderer === 'react-islands' ||
    resourceRenderer === 'react-owned';
  const example = isNext ? 'nextjs-payload' : isHTML ? 'pure-html' : `${framework}-payload`;
  const dependencyRoot = isAstroResources
    ? resolve(ROOT, resourceVersion!.dependencyRoot)
    : isAstro || isVue
      ? resolve(ROOT, `tests/fixtures/${framework}-host-deps`)
      : resolve(ROOT, 'examples', example);
  const prefix = isNext
    ? 'PLP_NEXT'
    : isNuxt
      ? 'PLP_NUXT'
      : isAstro
        ? 'PLP_ASTRO'
        : isHTML
          ? 'PLP_HTML'
          : isVue
            ? 'PLP_VUE'
            : 'PLP_SVELTE';
  const versionsToCheck = isAstroResources
    ? [
        'astro',
        '@astrojs/node',
        'vite',
        '@astrojs/check',
        'typescript',
        'payload-live-preview',
        ...(isAstroReact
          ? ['@astrojs/react', 'react', 'react-dom', '@types/react', '@types/react-dom']
          : []),
      ]
    : isVue
      ? [
          'vue',
          '@vue/server-renderer',
          '@vue/compiler-sfc',
          '@vitejs/plugin-vue',
          'vite',
          'vue-tsc',
          'typescript',
          'payload-live-preview',
        ]
      : isHTML
        ? ['payload-live-preview']
        : isNext
          ? ['next', 'react', 'react-dom', 'payload-live-preview']
          : isNuxt
            ? ['nuxt', 'vue', 'nitropack', 'h3', 'vite', 'payload-live-preview']
            : isAstro
              ? ['astro', '@astrojs/node', 'vite', 'payload-live-preview']
              : [
                  '@sveltejs/kit',
                  '@sveltejs/adapter-node',
                  '@sveltejs/vite-plugin-svelte',
                  'svelte',
                  'vite',
                  'payload-live-preview',
                ];
  const tarball = process.env['PLP_CONTINUATION_TARBALL'];
  assert.ok(tarball, 'PLP_CONTINUATION_TARBALL must name the retained archive');
  const archive = resolve(tarball);
  const directory = await mkdtemp(join(tmpdir(), `plp-${framework}-continuation-`));
  const cms = join(directory, 'cms');
  const app = join(directory, 'app');
  const port = isNext
    ? '4284'
    : isNuxt
      ? '4286'
      : isAstro
        ? '4287'
        : isHTML
          ? '4288'
          : isVue
            ? '4289'
            : '4285';
  // 428x0 overlaps this host's ephemeral range (32768-60999). Keep private
  // listeners below it so outbound fixture connections cannot claim the port.
  const internalPort = String(Number(port) + 10_000);
  const origin = `https://localhost:${port}`;
  const secret = randomBytes(48).toString('base64url');
  const environment = sanitizeNpmScriptEnvironment(process.env);
  const logs: string[] = [];
  const command = (args: string[], cwd: string): void => {
    const result = spawnSync('npm', args, {
      cwd,
      env: environment,
      encoding: 'utf8',
      timeout: 180_000,
    });
    logs.push(`npm ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.status, 0, 'Isolated dependency install failed; see setup log');
  };
  const install = PACKAGE_SMOKE_INSTALL_ARGS.filter((arg) => arg !== '--omit=optional');
  let backend: NativeACLFixture | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  const close = async (): Promise<void> => {
    if (child?.exitCode === null) {
      const ended = new Promise<void>((yes) => child!.once('exit', () => yes()));
      child.kill('SIGTERM');
      await ended;
    }
    if (backend) {
      await backend.close();
      backend = undefined;
    }
    await mkdir(artifact, { recursive: true });
    await writeFile(join(artifact, 'setup.log'), logs.join('\n'));
    await rm(directory, { recursive: true, force: true });
  };
  try {
    assert.deepEqual(findPackageSmokeIsolationViolations(ROOT, directory), []);
    await mkdir(cms);
    await mkdir(app);
    for (const file of ['package.json', 'package-lock.json', '.npmrc']) {
      await copyFile(resolve(ROOT, 'tests/fixtures/payload-acl', file), join(cms, file));
    }
    await copyFile(
      resolve(ROOT, 'examples/payload-backend/acl-fixture.ts'),
      join(cms, 'acl-fixture.ts'),
    );
    command(
      ['ci', ...install.filter((arg) => arg !== '--package-lock=false' && arg !== '--no-save')],
      cms,
    );
    const { startACLFixture: start } = (await import(
      pathToFileURL(join(cms, 'acl-fixture.ts')).href
    )) as { startACLFixture: StartACLFixture };
    backend = await start({ versionedRelated: true });
    const manifest = JSON.parse(await readFile(join(dependencyRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
      allowScripts?: Record<string, boolean>;
    };
    const lock = JSON.parse(await readFile(join(dependencyRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<
        string,
        {
          version?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          [key: string]: unknown;
        }
      >;
    };
    // Replace only the workspace package record with the reviewed archive.
    // A second npm install would re-resolve transitive peers (notably Vite).
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
    const packed = spawnSync('tar', ['-xOf', archive, 'package/package.json'], {
      encoding: 'utf8',
    });
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
    await writeFile(join(app, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(app, 'package-lock.json'), JSON.stringify(lock));
    if (isHTML) await writeFile(join(app, '.npmrc'), PACKAGE_SMOKE_NPMRC);
    else await copyFile(join(dependencyRoot, '.npmrc'), join(app, '.npmrc'));
    command(
      ['ci', ...install.filter((arg) => arg !== '--package-lock=false' && arg !== '--no-save')],
      app,
    );
    if (isHTML) {
      const probe = probeUnavailableDependencies(app, [
        'astro',
        '@astrojs/node',
        'next',
        'nuxt',
        'react',
        'react-dom',
        'svelte',
        '@sveltejs/kit',
        'vue',
        'vite',
        'esbuild',
        'payload',
      ]);
      logs.push(`Framework-free resolution probe\n${probe.stdout}\n${probe.stderr}`);
      assert.equal(probe.status, 0, 'Plain HTML consumer resolved a framework or CMS dependency');
      const installed = (await readdir(join(app, 'node_modules'))).filter(
        (name) => !name.startsWith('.'),
      );
      assert.deepEqual(installed, ['payload-live-preview']);
    }
    if (isVue) {
      const probe = probeUnavailableDependencies(app, [
        'nuxt',
        'nitropack',
        'next',
        'react',
        'react-dom',
        'astro',
        '@astrojs/node',
        'svelte',
        '@sveltejs/kit',
        'payload',
      ]);
      logs.push(`Standalone Vue resolution probe\n${probe.stdout}\n${probe.stderr}`);
      assert.equal(
        probe.status,
        0,
        'Standalone Vue consumer resolved an unrelated framework or CMS',
      );
    }
    for (const name of versionsToCheck) {
      const actual = await realpath(join(app, 'node_modules', name));
      assert.ok(actual.startsWith(`${app}/node_modules/`), 'Consumer dependency escaped isolation');
    }
    await templates(resolve(ROOT, `tests/fixtures/${framework}-continuation`), app);
    if (isAstroResources) {
      await templates(resolve(ROOT, 'tests/fixtures/astro-resources'), app);
      await prepareAstroResourceVersion(app, resourceVersion!.version);
      if (resourceRenderer === 'package-default') {
        // This exact floor is a reproduction, not a green context/resource claim:
        // its public Container API has no props option. Exercise the packed default.
        await templates(resolve(ROOT, 'tests/fixtures/astro-resource-floor'), app);
      }
      if (resourceRenderer === 'locals-catalog') {
        await templates(resolve(ROOT, 'tests/fixtures/astro-resource-locals'), app);
      }
      if (isAstroReact) await templates(resolve(ROOT, 'tests/fixtures/astro-react-resources'), app);
      if (resourceRenderer === 'react-islands') {
        await templates(resolve(ROOT, 'tests/fixtures/astro-react-islands'), app);
      }
      if (resourceRenderer === 'react-owned') {
        // Reuse the reviewed bootstrap policy, not the broken fragment islands.
        for (const path of [
          'middleware.ts',
          'server/island-csp.ts',
          'pages/island-csp-probe.astro',
          'components/ReactControl.astro',
        ]) {
          await copyFile(
            resolve(ROOT, 'tests/fixtures/astro-react-islands/src', path + '.fixture'),
            join(app, 'src', path),
          );
        }
        for (const path of ['components/StyledCard.astro', 'pages/payload/resource-fragment.ts']) {
          await copyFile(
            resolve(ROOT, 'tests/fixtures/astro-resources/src', path + '.fixture'),
            join(app, 'src', path),
          );
        }
        await templates(resolve(ROOT, 'tests/fixtures/astro-react-owned'), app);
        await mkdir(artifact, { recursive: true });
        for (const [path, name] of [
          ['@astrojs/react/dist/client.js', 'react-client.js'],
          ['astro/dist/runtime/server/astro-island.js', 'astro-island.js'],
        ] as const) {
          await copyFile(join(app, 'node_modules', path), join(artifact, name));
        }
      }
      await checkAstroResourceTemplates(
        app,
        artifact,
        environment,
        logs,
        isAstroReact,
        resourceRenderer === 'react-islands',
      );
    }
    if (isVue) {
      const counterexample = join(app, 'src/__typecheck_counterexample.vue');
      await copyFile(join(app, 'type-contracts/Negative.vue'), counterexample);
      const negative = spawnSync('npm', ['run', 'typecheck'], {
        cwd: app,
        env: environment,
        encoding: 'utf8',
        timeout: 60_000,
      });
      logs.push(`npm run typecheck (negative SFC control)\n${negative.stdout}\n${negative.stderr}`);
      await unlink(counterexample);
      assert.equal(negative.status, 2, 'Semantic template counterexample must fail');
      assert.ok(negative.stdout.includes('__typecheck_counterexample.vue'));
      assert.ok(negative.stdout.includes('TS2551'));
      assert.ok(negative.stdout.includes("Property 'toFixed' does not exist on type 'string'"));
      assert.equal((negative.stdout.match(/error TS/gu) ?? []).length, 1);
      await mkdir(artifact, { recursive: true });
      await writeFile(
        join(artifact, 'typecheck-control.json'),
        JSON.stringify(
          {
            argv: ['npm', 'run', 'typecheck'],
            exit: negative.status,
            counterexample: 'src/__typecheck_counterexample.vue',
            error: 'TS2551',
            removedBeforeProductionBuild: true,
          },
          null,
          2,
        ),
      );
    }
    await build({
      entryPoints: {
        reference: resolve(ROOT, 'tests/fixtures/preview-next-host.ts'),
        ...(isNuxt || isHTML || isVue
          ? { 'native-request': resolve(ROOT, 'tests/fixtures/preview-native-request.ts') }
          : {}),
        ...(isHTML || isVue
          ? { 'html-host': resolve(ROOT, 'tests/fixtures/preview-html-host.ts') }
          : {}),
      },
      outdir: app,
      outExtension: { '.js': '.mjs' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      metafile: true,
      plugins: [
        {
          name: 'installed-package-only',
          setup(builder) {
            // esbuild executes this filter in Go, which has no JavaScript u flag.
            builder.onResolve({ filter: /^(@\/server\/|@security\/)/ }, () => ({
              path: 'payload-live-preview/server',
              external: true,
            }));
          },
        },
      ],
    }).then(async (result) => {
      assert.ok(
        Object.keys(result.metafile.inputs).every((path) => !path.startsWith('src/')),
        'Reference bundle imported workspace production code',
      );
      await mkdir(artifact, { recursive: true });
      await writeFile(
        join(artifact, 'reference-metafile.json'),
        JSON.stringify(result.metafile, null, 2),
      );
    });
    const configPath = join(directory, 'private-config.json');
    await writeFile(
      configPath,
      JSON.stringify({ audience: origin, serverURL: backend.origin, secret, ids: backend.ids }),
      { mode: 0o600 },
    );
    const certificatePath = join(directory, 'public-certificate.pem');
    child = spawn(
      process.execPath,
      [resolve(ROOT, `scripts/${framework}-production-fixture.mjs`)],
      {
        cwd: ROOT,
        env: {
          ...environment,
          NEXT_TELEMETRY_DISABLED: '1',
          [`${prefix}_ORIGIN`]: origin,
          [`${prefix}_INTERNAL_PORT`]: internalPort,
          [`${prefix}_FIXTURE_DIRECTORY`]: app,
          PLP_LIFETIME_CERTIFICATE: certificatePath,
          [`${prefix}_HOST_CONFIG`]: configPath,
          PLP_NEXT_PRIVATE_PREFIX: '/continuation/',
          ...(!baseline ? { [`${prefix}_HOST_ENABLED`]: 'local-test-only' } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout!.on('data', (data) => logs.push(String(data)));
    child.stderr!.on('data', (data) => logs.push(String(data)));
    const ready = async (): Promise<boolean> => {
      try {
        const ca = await readFile(certificatePath);
        return await new Promise<boolean>((yes) => {
          const req = request(`${origin}/`, { ca, timeout: 1_000 }, (response) => {
            response.resume();
            yes(response.statusCode === 200);
          });
          req.on('error', () => yes(false));
          req.on('timeout', () => req.destroy());
          req.end();
        });
      } catch {
        return false;
      }
    };
    const deadline = Date.now() + 120_000;
    while (!(await ready())) {
      assert.equal(child.exitCode, null, 'Native framework build/start exited; see setup log');
      assert.ok(Date.now() < deadline, 'Native framework build/start deadline exceeded');
      await new Promise((yes) => setTimeout(yes, 200));
    }
    const entry = (await import(
      pathToFileURL(join(app, 'node_modules/payload-live-preview/dist/server.js')).href
    )) as typeof ServerEntry;
    if (isHTML || isVue) await copyFile(join(app, 'dist/build.json'), join(artifact, 'build.json'));
    if (isAstroResources) {
      await recordAstroResources(app, artifact);
      await checkAstroBridgeRuntime(artifact, internalPort);
    }
    const versions: Record<string, string> = {};
    for (const name of versionsToCheck) {
      versions[name] = (
        JSON.parse(await readFile(join(app, 'node_modules', name, 'package.json'), 'utf8')) as {
          version: string;
        }
      ).version;
      if (name !== 'payload-live-preview') {
        assert.equal(versions[name], lock.packages[`node_modules/${name}`]!.version);
      }
    }
    await writeFile(
      join(artifact, 'identity.json'),
      JSON.stringify(
        {
          versions,
          tarballSHA256: checksum(await readFile(archive)),
          serverEntrySHA256: checksum(
            await readFile(join(app, 'node_modules/payload-live-preview/dist/server.js')),
          ),
          buildId: isNext
            ? await readFile(join(app, '.next/BUILD_ID'), 'utf8')
            : checksum(
                await readFile(
                  join(
                    app,
                    isHTML || isVue
                      ? 'dist/build.json'
                      : isNuxt
                        ? '.output/nitro.json'
                        : isAstro
                          ? 'dist/server/entry.mjs'
                          : '.svelte-kit/output/server/manifest-full.js',
                  ),
                ),
              ),
          framework,
          profile,
          resourceRenderer,
          internalPort,
          frameworkLockSHA256: checksum(JSON.stringify(lock)),
          baseline,
        },
        null,
        2,
      ),
    );
    return {
      origin,
      framework,
      backend,
      close,
      async token(editor: 'a' | 'b', locale: 'de' | 'en', ttlMs = 60_000) {
        return entry.issuePreviewToken(
          {
            audience: origin,
            path: `/continuation/${editor}/${locale}`,
            locale,
            subject: backend!.ids[`user-${editor}`]!,
            ttlMs,
          },
          { secret },
        );
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
