/**
 * Read isolated package identities without importing their code or relying on
 * a package.json export. The same checks protect installation and execution;
 * archive files must match the selected bytes, not merely the version string.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (path, directory) => path.startsWith(directory + sep);

export function readRunSettings(here, input) {
  if (!input) throw new Error('PLP_P2_RUN_FILE must select a prepared run');
  const runFile = realpathSync(input);
  const settings = JSON.parse(readFileSync(runFile, 'utf8'));
  const run = realpathSync(settings.run);
  const runs = realpathSync(join(here, 'runs'));
  if (!inside(run, runs) || runFile !== join(run, 'run.json'))
    throw new Error('Unexpected run directory');
  const app = realpathSync(settings.app);
  if (app !== join(run, 'app')) throw new Error('Unexpected isolated consumer directory');
  if (!['frontend-only', 'server-url'].includes(settings.variant))
    throw new Error('Unexpected fixture variant');
  const id = settings.database?.match(/^plp_r4_p2_([a-f0-9]{12})$/u)?.[1];
  if (!id || settings.container !== 'plp-r4-p2-' + id)
    throw new Error('Unexpected run-owned database or container identity');
  const ports = [settings.adminPort, settings.sitePort, settings.mongoPort];
  if (
    ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 32767) ||
    new Set(ports).size !== 3
  )
    throw new Error('Unexpected isolated ports');
  if (
    settings.admin !== `http://localhost:${settings.adminPort}` ||
    settings.site !== `http://localhost:${settings.sitePort}`
  )
    throw new Error('Unexpected fixture origins');
  if (!/^[a-f0-9]{64}$/u.test(settings.candidate?.sha256 ?? ''))
    throw new Error('Missing candidate digest');
  if (
    settings.mongoImage !==
    'mongo@sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca'
  )
    throw new Error('Unexpected Mongo image');
  if (
    !Array.isArray(settings.browsers) ||
    settings.browsers.length === 0 ||
    new Set(settings.browsers).size !== settings.browsers.length ||
    settings.browsers.some((name) => !['chromium', 'firefox', 'webkit'].includes(name))
  )
    throw new Error('Unexpected browser selection');
  return { settings, runFile, run, app };
}

export function packageIdentity(appPath, name, entry = name) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(name)) throw new Error('Unexpected package name');
  const app = realpathSync(appPath);
  const modules = realpathSync(join(app, 'node_modules'));
  if (modules !== join(app, 'node_modules'))
    throw new Error('Consumer node_modules is linked outside the consumer');
  const packageRoot = realpathSync(join(modules, name));
  if (!inside(packageRoot, modules))
    throw new Error('Package was linked outside the isolated consumer');
  const bytes = readFileSync(join(packageRoot, 'package.json'));
  const manifest = JSON.parse(bytes);
  if (manifest.name !== name || typeof manifest.version !== 'string')
    throw new Error('Installed package identity mismatch');
  const localRequire = createRequire(join(app, 'package.json'));
  const resolvedEntry = realpathSync(localRequire.resolve(entry));
  if (!inside(resolvedEntry, packageRoot))
    throw new Error('Package entry resolved outside its installed package');
  return {
    name,
    version: manifest.version,
    packageRoot,
    resolvedEntry,
    manifestSha256: digest(bytes),
  };
}

export function verifyInstalledCandidate(app, candidate, inventory) {
  const installed = packageIdentity(app, 'payload-live-preview');
  if (installed.version !== candidate.version || inventory.sha256 !== candidate.sha256)
    throw new Error('Installed candidate identity mismatch');
  const vendor = readFileSync(join(app, 'vendor/payload-live-preview.tgz'));
  if (digest(vendor) !== candidate.sha256) throw new Error('Candidate archive changed');
  for (const [path, expected] of Object.entries(inventory.files)) {
    const absolute = realpathSync(join(installed.packageRoot, path));
    if (!inside(absolute, installed.packageRoot))
      throw new Error('Packed candidate file resolves outside the consumer');
    const bytes = readFileSync(absolute);
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256)
      throw new Error('Installed candidate differs from its packed file: ' + path);
  }
  for (const entry of [
    'payload-live-preview',
    'payload-live-preview/plugin',
    'payload-live-preview/server',
  ])
    packageIdentity(app, 'payload-live-preview', entry);
  return {
    ...installed,
    verifiedPackedFiles: Object.keys(inventory.files).length,
    archiveSha256: candidate.sha256,
  };
}

export function ownsContainer(info, settings, id) {
  return (
    /^[a-f0-9]{64}$/u.test(id ?? '') &&
    info?.Id === id &&
    info.Name === '/' + settings.container &&
    info.Config?.Image === settings.mongoImage &&
    info.Config?.Labels?.['plp.unit'] === 'r4-payload2-real-admin' &&
    info.Config?.Labels?.['plp.run'] === settings.run &&
    info.Config?.Labels?.['plp.variant'] === settings.variant
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [app, ...packages] = process.argv.slice(2);
  if (!app || packages.length === 0)
    throw new Error('Usage: node identity.mjs /absolute/consumer package [package]');
  console.log(
    JSON.stringify(
      packages.map((name) => packageIdentity(app, name)),
      null,
      2,
    ),
  );
}
