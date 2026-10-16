/**
 * Materialize an isolated consumer from a chosen immutable candidate archive.
 * This step performs no install, build, container or server action. Credentials
 * are generated into a private run file that is never copied into the admin bundle.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.env.PLP_P2_TARBALL;
if (!input || !isAbsolute(input))
  throw new Error('PLP_P2_TARBALL must select an absolute packed candidate path');
const archive = realpathSync(input);
const bytes = readFileSync(archive);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (
  !/^[a-f0-9]{64}$/u.test(process.env.PLP_P2_TARBALL_SHA256 ?? '') ||
  process.env.PLP_P2_TARBALL_SHA256 !== sha256
)
  throw new Error('PLP_P2_TARBALL_SHA256 must match the selected candidate');
const candidate = JSON.parse(
  execFileSync('python3', [join(here, 'archive-inspect.py'), archive], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  }),
);
if (candidate.sha256 !== sha256) throw new Error('Archive inspection digest mismatch');
const variant = process.env.PLP_P2_VARIANT ?? 'frontend-only';
if (!['frontend-only', 'server-url'].includes(variant))
  throw new Error('PLP_P2_VARIANT must be frontend-only or server-url');

const surface = process.env.PLP_P2_SURFACE ?? 'dom';
if (!['dom', 'react', 'vue'].includes(surface)) throw new Error('Unexpected v2 native surface');

mkdirSync(join(here, 'runs'), { recursive: true });
const run = mkdtempSync(join(here, 'runs', 'p2-'));
const app = join(run, 'app');
cpSync(join(here, 'template'), app, { recursive: true });
if (surface !== 'dom') {
  cpSync(join(here, 'native-frontend'), join(app, 'frontend'), { recursive: true });
  cpSync(join(here, 'native/ledger.mjs'), join(app, 'frontend/ledger.mjs'));
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  Object.assign(manifest.dependencies, {
    vue: '3.5.42',
    '@vue/server-renderer': '3.5.42',
    esbuild: '0.28.2',
  });
  Object.assign(manifest.allowScripts, { 'esbuild@0.28.2': true, 'es5-ext@0.10.64': false });
  manifest.overrides = {
    'payload@2.32.3': { 'i18next-http-middleware': '3.9.7' },
    '@payloadcms/db-mongodb@1.7.5': { mongoose: '6.13.10' },
  };
  writeFileSync(join(app, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
}
mkdirSync(join(app, 'vendor'));
writeFileSync(join(app, 'vendor', 'payload-live-preview.tgz'), bytes);
const id = randomBytes(6).toString('hex');
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 32767)
    throw new Error(name + ' must be a local non-ephemeral port');
  return value;
};
const adminPort = port('PLP_P2_ADMIN_PORT', 4481);
const sitePort = port('PLP_P2_SITE_PORT', 4482);
const mongoPort = port('PLP_P2_MONGO_PORT', 27218);
if (new Set([adminPort, sitePort, mongoPort]).size !== 3)
  throw new Error('Fixture ports must be distinct');
const settings = {
  run,
  app,
  variant,
  surface,
  adminPort,
  sitePort,
  mongoPort,
  admin: `http://localhost:${adminPort}`,
  site: `http://localhost:${sitePort}`,
  database: 'plp_r4_p2_' + id,
  container: 'plp-r4-p2-' + id,
  mongoImage: 'mongo@sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca',
  email: `p2-${id}@example.invalid`,
  password: randomBytes(24).toString('base64url'),
  secret: randomBytes(32).toString('base64url'),
  candidate: { name: candidate.name, version: candidate.version, sha256 },
  browsers: (process.env.PLP_P2_BROWSERS ?? 'chromium,firefox,webkit').split(','),
};
if (
  new Set(settings.browsers).size !== settings.browsers.length ||
  settings.browsers.some((browser) => !['chromium', 'firefox', 'webkit'].includes(browser))
)
  throw new Error('Unexpected browser');
writeFileSync(join(run, 'run.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
writeFileSync(join(run, 'archive-inventory.json'), JSON.stringify(candidate, null, 2) + '\n');
const root = realpathSync(process.env.PLP_VERSION_LANES_REPO);
writeFileSync(
  join(run, 'preparation.json'),
  JSON.stringify(
    {
      preparedAt: new Date().toISOString(),
      repositoryHeadObserved: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      sourceProvenance:
        'selected local archive; repository HEAD and version are not a clean-source or release proof',
      candidate: {
        sourcePath: archive,
        name: candidate.name,
        version: candidate.version,
        sha256,
        bytes: bytes.length,
        packedFiles: candidate.fileCount,
        sha512Integrity: candidate.sha512Integrity,
        publicEntries: candidate.publicEntries,
      },
      variant,
      surface,
      runtimeNode: process.version,
      state: 'prepared-only-not-installed-not-executed',
      ports: { adminPort, sitePort, mongoPort },
      database: settings.database,
      mongoImage: settings.mongoImage,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    runFile: join(run, 'run.json'),
    preparation: join(run, 'preparation.json'),
    candidateSha256: sha256,
    variant,
    plannedBrowserTests: (surface === 'dom' ? 8 : 3) * settings.browsers.length,
  }),
);
