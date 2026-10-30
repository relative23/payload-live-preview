/**
 * Build and serve the Next fixture through a local TLS reverse proxy. The
 * public side matches strict production policy while `next start` stays on an
 * unexposed loopback port, the usual self-hosted deployment shape.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveBundler, nextBuildArguments } from './next-build-arguments.mjs';
import { startTlsFront } from './tls-front.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = process.env['PLP_NEXT_FIXTURE_DIRECTORY']
  ? resolve(process.env['PLP_NEXT_FIXTURE_DIRECTORY'])
  : resolve(ROOT, 'examples/nextjs-payload');
const NEXT_BIN = resolve(FIXTURE, 'node_modules/next/dist/bin/next');
const PUBLIC_ORIGIN = process.env['PLP_NEXT_ORIGIN'] ?? 'https://localhost:4274';
const publicUrl = new URL(PUBLIC_ORIGIN);
if (publicUrl.protocol !== 'https:') {
  throw new Error('PLP_NEXT_ORIGIN must use HTTPS for the production fixture.');
}
// The private listener sits below the ephemeral range (32768-60999), so an outbound connection cannot claim it.
const internalPort = Number(process.env['PLP_NEXT_INTERNAL_PORT'] ?? '14274');
// The mock admin is a page of the fixture itself. A run against a real admin names that
// admin's HTTPS origin instead (playwright.real-payload.config.ts).
const adminOrigin = process.env['PLP_PRODUCTION_ADMIN_ORIGIN'] ?? publicUrl.origin;
const environment = {
  ...process.env,
  NODE_ENV: 'production',
  PAYLOAD_ADMIN_ORIGIN: adminOrigin,
};

const bundler = process.env['PLP_NEXT_BUILD_BUNDLER'];
if (bundler !== undefined && bundler !== 'webpack' && bundler !== 'turbopack') {
  throw new Error('PLP_NEXT_BUILD_BUNDLER must be webpack or turbopack.');
}
/** @type {{ version: string }} */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- plain Node entry; the file is Next's own manifest
const nextManifest = JSON.parse(
  readFileSync(resolve(FIXTURE, 'node_modules/next/package.json'), 'utf8'),
);
const nextMajor = Number(nextManifest.version.split('.')[0]);
process.stdout.write(
  `Next production fixture build bundler: ${effectiveBundler(bundler, nextMajor)} (Next ${String(nextMajor)})\n`,
);

const build = spawnSync('npm', nextBuildArguments(bundler, nextMajor), {
  cwd: FIXTURE,
  env: environment,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const next = spawn(
  process.execPath,
  [NEXT_BIN, 'start', '--hostname', '127.0.0.1', '--port', String(internalPort)],
  { cwd: FIXTURE, env: environment, stdio: 'inherit' },
);

const proxy = startTlsFront({
  label: 'Next production fixture',
  publicUrl,
  internalPort,
  // Next's page renderer overwrites config-level Vary. This fixture's
  // trusted TLS front door retains the private route's Cookie variation
  // alongside RSC/router values; it never changes the public routes.
  adjust: (incoming, response) => {
    const privatePrefix = process.env['PLP_NEXT_PRIVATE_PREFIX'];
    if (privatePrefix && incoming.url?.startsWith(privatePrefix)) {
      const vary = (response.headers.vary ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (!vary.some((part) => part.toLowerCase() === 'cookie')) vary.push('Cookie');
      response.headers.vary = vary.join(', ');
    }
  },
});

let stopping = false;
/** @type {(signal: NodeJS.Signals) => void} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain Node entry, intentionally runnable without a TypeScript loader
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  proxy.close();
  if (next.exitCode === null) next.kill(signal);
};

process.once('SIGINT', () => {
  stop('SIGINT');
});
process.once('SIGTERM', () => {
  stop('SIGTERM');
});
next.once('exit', (code, signal) => {
  if (!stopping) {
    process.exitCode = code ?? (signal === null ? 1 : 0);
    proxy.close();
  }
});
