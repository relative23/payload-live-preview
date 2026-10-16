/**
 * Compile a freshly installed lane using only its own exact compiler and peers.
 * The retained SDK stays a regular installed archive; compiler input identities
 * and initial native SSR are recorded before a real admin is ever started.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { read, digest, verifyOwnedGraph } from './owned-graph.mjs';

assert.equal(process.argv.length, 4, 'Use --prepared=<manifest> --lock-sha256=<reviewed-lock>');
const preparedPath = resolve(process.argv[2].slice('--prepared='.length));
const lockSHA256 = process.argv[3].slice('--lock-sha256='.length);
assert.ok(
  process.argv[2].startsWith('--prepared=') && process.argv[3].startsWith('--lock-sha256='),
);
assert.match(lockSHA256, /^[a-f0-9]{64}$/u);
const prepared = read(preparedPath);
const graph = verifyOwnedGraph(prepared, prepared.laneDefinition, lockSHA256);
const work = prepared.app;
const frontend = resolve(work, 'frontend');
const compiler = resolve(work, 'node_modules/esbuild/bin/esbuild');
assert.ok(realpathSync(compiler).startsWith(resolve(work, 'node_modules') + sep));
const builds = [];
for (const surface of ['react', 'vue'])
  for (const side of ['client', 'ssr']) {
    const client = side === 'client';
    const output =
      'dist/' + (client ? 'assets/' + surface + '-client.js' : 'ssr/' + surface + '-ssr.mjs');
    const meta = surface + '-' + side + '-metafile.json';
    const args = [
      surface + '-' + side + '.mjs',
      '--bundle',
      '--format=esm',
      '--platform=' + (client ? 'browser' : 'node'),
      '--outfile=' + output,
      '--metafile=' + meta,
      '--define:process.env.NODE_ENV="development"',
      '--define:__VUE_OPTIONS_API__=true',
      '--define:__VUE_PROD_DEVTOOLS__=false',
      '--define:__VUE_PROD_HYDRATION_MISMATCH_DETAILS__=true',
      ...(client
        ? []
        : [
            '--external:react',
            '--external:react-dom/server',
            '--external:vue',
            '--external:@vue/server-renderer',
            '--external:payload-live-preview/react',
            '--external:payload-live-preview/vue',
          ]),
    ];
    const result = spawnSync(compiler, args, {
      cwd: frontend,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    writeFileSync(
      resolve(work, surface + '-' + side + '-build.log'),
      result.stdout + result.stderr,
      { flag: 'wx', mode: 0o600 },
    );
    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    assert.ok(!result.error);
    const metadata = read(resolve(frontend, meta));
    const inputs = Object.keys(metadata.inputs).map((path) => {
      const actual = realpathSync(resolve(frontend, path));
      assert.ok(
        actual.startsWith(work + sep),
        'A root/foreign package entered the isolated compiler graph',
      );
      return { path: actual, sha256: digest(actual) };
    });
    builds.push({ surface, side, output, meta, sha256: digest(resolve(frontend, output)), inputs });
  }
const nativeSSR = [];
for (const surface of ['react', 'vue']) {
  const module = await import(
    pathToFileURL(resolve(frontend, 'dist/ssr/' + surface + '-ssr.mjs')).href
  );
  const markup = await module.render({
    admin: 'http://localhost:' + prepared.ports.admin,
    document: 'homepage',
  });
  assert.ok(markup.includes('Initial homepage') && markup.includes('data-testid="revision">0<'));
  nativeSSR.push({ surface, initialDocumentRendered: true });
}
const identity = {
  schemaVersion: 1,
  payloadLane: prepared.lane,
  payloadVersion: prepared.payloadVersion,
  archive: {
    path: prepared.vendor,
    sha256: prepared.archiveSHA256,
    packageVersion: prepared.archiveVersion,
  },
  graph,
  builds,
  nativeSSR,
  dependencies: graph.identities.map((item) => ({
    ...item,
    consumer: ['vue', '@vue/server-renderer'].includes(item.name) ? 'frontend' : 'cms',
  })),
  scope:
    'Own installed Payload ' +
    prepared.payloadVersion +
    ' native developmental consumer; exact archive and actual wire observation. No release/floor/production or another Payload-family guarantee.',
};
writeFileSync(resolve(work, 'identity.json'), JSON.stringify(identity, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
writeFileSync(resolve(frontend, 'identity.json'), JSON.stringify(identity, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
mkdirSync(resolve(work, 'observations'), { recursive: true });
console.log(
  JSON.stringify({
    status: 'own-lane-compiler-and-initial-SSR-passed-native-admin-not-started',
    payloadVersion: prepared.payloadVersion,
    builds: builds.length,
    nativeSSR: nativeSSR.length,
  }),
);
