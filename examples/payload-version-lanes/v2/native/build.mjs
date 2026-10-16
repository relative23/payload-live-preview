/**
 * Compile the selected native tree using its regular installed peers and SDK.
 * Record actual compiler inputs before the real Payload admin starts; a root
 * framework dependency or a different installed archive refuses the stage.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  digest,
  packageIdentity,
  readRunSettings,
  verifyInstalledCandidate,
} from '../identity.mjs';

assert.equal(process.env.PLP_P2_RESOURCES_RELEASED, '1');
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { settings, app, run } = readRunSettings(here, process.env.PLP_P2_RUN_FILE);
assert.ok(['react', 'vue'].includes(settings.surface));
const inventory = JSON.parse(readFileSync(join(run, 'archive-inventory.json'), 'utf8'));
verifyInstalledCandidate(app, settings.candidate, inventory);
const compiler = packageIdentity(app, 'esbuild');
assert.equal(compiler.version, '0.28.2');
const frontend = join(app, 'frontend');
const builds = [];
for (const side of ['client', 'ssr']) {
  const client = side === 'client';
  const output =
    'dist/' +
    (client ? 'assets/' : 'ssr/') +
    settings.surface +
    (client ? '-client.js' : '-ssr.mjs');
  const meta = settings.surface + '-' + side + '-metafile.json';
  const args = [
    settings.surface + '-' + side + '.mjs',
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
  const result = spawnSync(join(compiler.packageRoot, 'bin/esbuild'), args, {
    cwd: frontend,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', ESBUILD_BINARY_PATH: '' },
  });
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.ok(!result.error);
  const inputs = Object.keys(JSON.parse(readFileSync(join(frontend, meta), 'utf8')).inputs).map(
    (name) => {
      const path = realpathSync(resolve(frontend, name));
      assert.ok(path.startsWith(app + sep), 'Root/foreign package entered native compilation');
      return { path, sha256: digest(readFileSync(path)) };
    },
  );
  if (client) {
    const packed = join(
      app,
      'node_modules/payload-live-preview',
      inventory.publicEntries['./' + settings.surface].import,
    );
    assert.ok(
      inputs.some((row) => row.path === packed),
      'Compiler omitted the packed native entry',
    );
  }
  builds.push({ side, args, inputs, outputSHA256: digest(readFileSync(join(frontend, output))) });
}
writeFileSync(
  join(run, 'native-build.json'),
  JSON.stringify(
    {
      surface: settings.surface,
      variant: settings.variant,
      archiveSHA256: settings.candidate.sha256,
      compiler,
      builds,
      actualAdminStarted: false,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx', mode: 0o600 },
);
