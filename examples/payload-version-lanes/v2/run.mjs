/**
 * Run only after the coordinator releases CPU and browser resources. This
 * creates one labeled disposable Mongo container (capped at 2 GiB, removed when
 * it stops, run as the calling user) and two loopback processes, records the exact
 * installed identities, and stops only resources it created.
 */
import { createRequire } from 'node:module';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import {
  digest,
  readRunSettings,
  packageIdentity,
  planTitles,
  verifyInstalledCandidate,
  ownsContainer,
} from './identity.mjs';
import { auditRun } from './audit.mjs';
import diagnostics from './template/diagnostics.cjs';

if (process.env.PLP_P2_RESOURCES_RELEASED !== '1')
  throw new Error('Wait for the coordinator to release server and browser resources');
const here = dirname(fileURLToPath(import.meta.url));
const root = realpathSync(process.env.PLP_VERSION_LANES_REPO);
const { settings, runFile, run, app } = readRunSettings(here, process.env.PLP_P2_RUN_FILE);
const redact = diagnostics.redactor(settings);
if (!existsSync(join(run, 'install.json'))) throw new Error('Install this isolated consumer first');
const inventory = JSON.parse(readFileSync(join(run, 'archive-inventory.json'), 'utf8'));
const installedCandidate = verifyInstalledCandidate(app, settings.candidate, inventory);
const install = JSON.parse(readFileSync(join(run, 'install.json'), 'utf8'));
const lockSha256 = digest(readFileSync(join(app, 'package-lock.json')));
if (install.lockSha256 !== lockSha256 || install.variant !== settings.variant)
  throw new Error('Installed dependency lock or variant changed');

const require = createRequire(join(app, 'package.json'));
const expected = {
  payload: '2.32.3',
  '@payloadcms/bundler-webpack': '1.0.9',
  '@payloadcms/db-mongodb': '1.7.5',
  '@payloadcms/richtext-lexical': '0.11.4',
  react: '18.3.1',
  'react-dom': '18.3.1',
  'react-select': '5.7.4',
  express: '4.21.2',
  ajv: '8.14.0',
  lexical: '0.13.1',
};
if (settings.surface !== 'dom')
  Object.assign(expected, {
    vue: '3.5.42',
    '@vue/server-renderer': '3.5.42',
    esbuild: '0.28.2',
  });
const installed = {};
const installedIdentities = {};
for (const [name, version] of Object.entries(expected)) {
  const info = packageIdentity(app, name);
  if (info.version !== version) throw new Error(name + ' installed version mismatch');
  installed[name] = info.version;
  installedIdentities[name] = info;
}
// These exact native modules were the historical npm-12 installation trap.
const sharpIdentity = packageIdentity(app, 'sharp');
const swcIdentity = packageIdentity(app, '@swc/core');
if (sharpIdentity.version !== '0.32.6' || swcIdentity.version !== '1.6.1')
  throw new Error('Unexpected native module version');
const sharp = require('sharp');
const swc = require('@swc/core');
await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
  .png()
  .toBuffer();
if (!swc.transformSync('const value = 1', {}).code.includes('value'))
  throw new Error('SWC native preflight failed');
if (settings.surface !== 'dom') {
  const built = spawnSync(process.execPath, [join(here, 'native/build.mjs')], {
    cwd: app,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', ESBUILD_BINARY_PATH: '' },
  });
  writeFileSync(
    join(run, 'native-build.log'),
    redact(built.stdout ?? '') + redact(built.stderr ?? ''),
    { flag: 'wx', mode: 0o600 },
  );
  if (built.status !== 0 || built.signal || built.error)
    throw new Error('Owned native compilation failed');
}
const mongo = spawnSync(
  'docker',
  ['image', 'inspect', settings.mongoImage, '--format', '{{.Id}}'],
  { encoding: 'utf8' },
);
if (mongo.status !== 0) throw new Error('Pinned Mongo image is unavailable locally');
const identity = {
  startedAt: new Date().toISOString(),
  node: process.version,
  candidate: settings.candidate,
  variant: settings.variant,
  installed,
  installedIdentities,
  installedCandidate,
  browserHarness: packageIdentity(root, '@playwright/test'),
  native: { sharp: sharpIdentity, swc: swcIdentity },
  mongoImage: settings.mongoImage,
  mongoImageId: mongo.stdout.trim(),
  dependencyLockSha256: lockSha256,
  browsers: settings.browsers,
  state: 'running-not-yet-verified',
};
writeFileSync(join(run, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');

async function assertFree(port) {
  await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolvePort));
  });
}

const children = [];
const logClosures = [];
let containerId;
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  await new Promise((done) => setTimeout(done, 2000));
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await Promise.allSettled(logClosures);
  if (containerId) {
    const inspected = spawnSync('docker', ['container', 'inspect', containerId], {
      encoding: 'utf8',
    });
    const info = inspected.status === 0 ? JSON.parse(inspected.stdout)[0] : undefined;
    if (!ownsContainer(info, settings, containerId)) {
      appendFileSync(
        join(run, 'cleanup.log'),
        'Container ownership no longer verified; cleanup refused\n',
        { mode: 0o600 },
      );
      process.exitCode = 1;
      return;
    }
    // Pin the exact created ID as well as run/name/image labels; a reused name is insufficient.
    const removed = spawnSync('docker', ['rm', '--force', containerId], { encoding: 'utf8' });
    // The container removes itself when it stops (--rm), so the daemon is a second remover and
    // may answer "removal already in progress"; what counts is that the container is gone.
    const gone = removed.status === 0 || (await containerGone(containerId));
    appendFileSync(
      join(run, 'cleanup.log'),
      'owned-container-remove exit ' +
        removed.status +
        (gone ? '' : ' container still present') +
        '\n',
      { mode: 0o600 },
    );
    if (!gone) process.exitCode = 1;
  }
}

async function containerGone(id) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (spawnSync('docker', ['container', 'inspect', id], { encoding: 'utf8' }).status !== 0)
      return true;
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await stop();
    process.exit(1);
  });

function start(file, label) {
  const log = createWriteStream(join(run, label + '.log'), { mode: 0o600 });
  const child = spawn(process.execPath, [join(settings.app, file)], {
    cwd: app,
    env: { ...process.env, PLP_P2_RUN_FILE: runFile, NODE_PATH: '', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(diagnostics.redactedStream(redact)).pipe(log, { end: false });
  child.stderr.pipe(diagnostics.redactedStream(redact)).pipe(log, { end: false });
  child.once('error', (error) => {
    child.startupError = diagnostics.diagnostic(error, redact);
  });
  logClosures.push(
    new Promise((done) => {
      child.once('close', () => log.end(done));
    }),
  );
  children.push(child);
  return child;
}

async function ready(url, child, timeout = 300_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child.exitCode !== null || child.startupError)
      throw new Error(
        'Owned fixture process exited before readiness' +
          (child.startupError ? ': ' + child.startupError : ''),
      );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('Owned fixture did not become ready within the startup bound');
}

try {
  for (const port of [settings.adminPort, settings.sitePort, settings.mongoPort])
    await assertFree(port);
  mkdirSync(join(run, 'mongo-data'), { mode: 0o700 });
  const created = spawnSync(
    'docker',
    [
      'create',
      '--pull=never',
      // The host shares its memory with every other job: cap the container, let it remove itself.
      '--memory=2g',
      '--memory-swap=2g',
      '--rm',
      // The image's own user would leave a data directory only root can delete: run mongod as the
      // user who owns the run directory.
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      '--name',
      settings.container,
      '--label',
      'plp.unit=r4-payload2-real-admin',
      '--label',
      'plp.run=' + run,
      '--label',
      'plp.variant=' + settings.variant,
      '--publish',
      `127.0.0.1:${settings.mongoPort}:27017`,
      '--mount',
      `type=bind,source=${join(run, 'mongo-data')},target=/data/db`,
      settings.mongoImage,
      '--bind_ip_all',
    ],
    { encoding: 'utf8' },
  );
  if (created.status !== 0) throw new Error('Could not create the new isolated Mongo container');
  containerId = created.stdout.trim();
  const inspected = spawnSync('docker', ['container', 'inspect', containerId], {
    encoding: 'utf8',
  });
  if (
    inspected.status !== 0 ||
    !ownsContainer(JSON.parse(inspected.stdout)[0], settings, containerId)
  )
    throw new Error('Created container ownership could not be verified');
  writeFileSync(
    join(run, 'container.json'),
    JSON.stringify(
      {
        id: containerId,
        name: settings.container,
        image: settings.mongoImage,
        variant: settings.variant,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  const started = spawnSync('docker', ['start', containerId], { encoding: 'utf8' });
  if (started.status !== 0) throw new Error('Could not start the owned Mongo container');
  const backend = start('server.cjs', 'backend');
  const preview = start('preview.mjs', 'preview');
  await ready(settings.admin + '/__plp_health', backend);
  const health = await (
    await fetch(settings.admin + '/__plp_health', { signal: AbortSignal.timeout(3000) })
  ).json();
  const expectedCsrf =
    settings.variant === 'frontend-only' ? [settings.site] : [settings.site, settings.admin];
  if (
    JSON.stringify(health.csrf) !== JSON.stringify(expectedCsrf) ||
    health.serverURL !== (settings.variant === 'frontend-only' ? '' : settings.admin) ||
    health.variant !== settings.variant
  )
    throw new Error('Actual sanitized Payload configuration does not match the pinned variant');
  identity.actualConfig = {
    csrf: health.csrf,
    serverURL: health.serverURL,
    variant: health.variant,
  };
  await ready(settings.site + '/__plp_health', preview);
  // The admin health route precedes Webpack; opening /admin also waits for its actual bundle.
  await ready(settings.admin + '/admin', backend);
  const child = spawn(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      join(here, 'browser/config.cjs'),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PLP_P2_RUN_FILE: runFile,
        NODE_PATH: '',
        DEBUG: '',
        PWDEBUG: '',
        PW_TEST_REPORTER: '',
      },
      stdio: 'inherit',
    },
  );
  children.push(child);
  const exitCode = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  });
  const report = JSON.parse(readFileSync(join(run, 'browser-results.json'), 'utf8'));
  identity.browserTotals = report.totals;
  const planned = planTitles(settings.specTitles);
  if (
    exitCode === 0 &&
    (report.status !== 'passed' ||
      report.totals.total !== planned.length * settings.browsers.length ||
      report.totals.passed !== report.totals.total ||
      report.totals.skipped !== 0 ||
      report.errors.length !== 0 ||
      settings.browsers.some((browser) => {
        const passed = report.tests.filter(
          (test) => test.project === browser && test.status === 'passed' && test.retry === 0,
        );
        return (
          JSON.stringify(passed.map((test) => test.title).sort()) !==
          JSON.stringify([...planned].sort())
        );
      }))
  )
    throw new Error('Browser result is incomplete, skipped, retried or not the expected matrix');
  identity.finishedAt = new Date().toISOString();
  identity.playwrightExit = exitCode;
  identity.state =
    exitCode === 0 ? 'browser-run-passed-pending-evidence-audit' : 'browser-run-failed';
  writeFileSync(join(run, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');
  if (exitCode !== 0) process.exitCode = 1;
} catch (error) {
  identity.finishedAt = new Date().toISOString();
  identity.state = 'fixture-run-failed';
  identity.error = diagnostics.diagnostic(error, redact);
  writeFileSync(join(run, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');
  console.error(identity.error);
  process.exitCode = 1;
} finally {
  await stop();
  const audit = auditRun(run, settings);
  writeFileSync(join(run, 'credential-audit.json'), JSON.stringify(audit, null, 2) + '\n', {
    mode: 0o600,
  });
  if (audit.findings.length) process.exitCode = 1;
}
