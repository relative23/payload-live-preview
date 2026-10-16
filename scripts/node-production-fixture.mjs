/**
 * Native Node outputs build behind the same local TLS boundary.
 * Only the framework launch path differs; proxy cancellation and certificate
 * cleanup retain one implementation for the production consumers.
 */

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { request as requestHttp } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindProxyLifetime } from './fixture-proxy-lifetime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** @param {'sveltekit' | 'nuxt' | 'astro' | 'html' | 'vue'} framework */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain Node entry shared by fixture launchers
export function runNodeProductionFixture(framework) {
  const isNuxt = framework === 'nuxt';
  const isAstro = framework === 'astro';
  const isHTML = framework === 'html';
  const isVue = framework === 'vue';
  const prefix = isNuxt
    ? 'PLP_NUXT'
    : isAstro
      ? 'PLP_ASTRO'
      : isHTML
        ? 'PLP_HTML'
        : isVue
          ? 'PLP_VUE'
          : 'PLP_SVELTE';
  const label = isNuxt
    ? 'Nuxt'
    : isAstro
      ? 'Astro'
      : isHTML
        ? 'Plain HTML'
        : isVue
          ? 'Vue'
          : 'SvelteKit';
  if (isHTML && !process.env.PLP_HTML_FIXTURE_DIRECTORY) {
    throw new Error('PLP_HTML_FIXTURE_DIRECTORY must name the isolated Node host.');
  }
  if (isVue && !process.env.PLP_VUE_FIXTURE_DIRECTORY) {
    throw new Error('PLP_VUE_FIXTURE_DIRECTORY must name the isolated Node host.');
  }
  const FIXTURE = process.env[`${prefix}_FIXTURE_DIRECTORY`]
    ? resolve(process.env[`${prefix}_FIXTURE_DIRECTORY`])
    : resolve(ROOT, `examples/${isAstro ? 'astro-middleware' : `${framework}-payload`}`);
  const PUBLIC_ORIGIN =
    process.env[`${prefix}_ORIGIN`] ??
    `https://localhost:${isNuxt ? '4276' : isAstro ? '4277' : isHTML ? '4288' : isVue ? '4289' : '4275'}`;
  const publicUrl = new URL(PUBLIC_ORIGIN);
  if (publicUrl.protocol !== 'https:') {
    throw new Error(`${prefix}_ORIGIN must use HTTPS for the production fixture.`);
  }
  const publicPort = Number(publicUrl.port || 443);
  const internalPort = Number(
    process.env[`${prefix}_INTERNAL_PORT`] ??
      (isNuxt ? '42760' : isAstro ? '42770' : isHTML ? '14288' : isVue ? '14289' : '42750'),
  );
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    PAYLOAD_ADMIN_ORIGIN: publicUrl.origin,
    ORIGIN: publicUrl.origin,
    HOST: '127.0.0.1',
    PORT: String(internalPort),
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(internalPort),
    ASTRO_TELEMETRY_DISABLED: '1',
  };

  const build = spawnSync('npm', ['run', 'build'], {
    cwd: FIXTURE,
    env: environment,
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const certificateDirectory = mkdtempSync(join(tmpdir(), `plp-${framework}-production-`));
  const keyPath = join(certificateDirectory, 'localhost-key.pem');
  const certificatePath = join(certificateDirectory, 'localhost-certificate.pem');
  const certificate = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  );
  if (certificate.status !== 0) {
    process.stderr.write(certificate.stderr);
    process.exit(certificate.status ?? 1);
  }
  // Export only the public certificate for the lifetime probe's pinned TLS client.
  const probeCertificate = process.env['PLP_LIFETIME_CERTIFICATE'];
  if (probeCertificate) {
    mkdirSync(dirname(probeCertificate), { recursive: true });
    copyFileSync(certificatePath, probeCertificate);
  }

  const app = spawn(
    process.execPath,
    [
      resolve(
        FIXTURE,
        isNuxt
          ? '.output/server/index.mjs'
          : isAstro
            ? 'dist/server/entry.mjs'
            : isHTML || isVue
              ? 'dist/server.mjs'
              : 'build/index.js',
      ),
    ],
    {
      cwd: FIXTURE,
      env: environment,
      stdio: 'inherit',
    },
  );

  const proxy = createServer(
    {
      key: readFileSync(keyPath),
      cert: readFileSync(certificatePath),
    },
    (incoming, outgoing) => {
      const host = incoming.headers.host ?? publicUrl.host;
      const upstream = requestHttp(
        {
          hostname: '127.0.0.1',
          port: internalPort,
          method: incoming.method,
          path: incoming.url,
          headers: {
            ...incoming.headers,
            host,
            'x-forwarded-host': host,
            'x-forwarded-port': String(publicPort),
            'x-forwarded-proto': 'https',
          },
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on('error', (error) => {
        if (outgoing.destroyed) return;
        if (outgoing.headersSent) {
          outgoing.destroy(error);
          return;
        }
        outgoing.writeHead(502, { 'content-type': 'text/plain' });
        outgoing.end(`${label} production fixture is not ready: ${error.message}`);
      });
      bindProxyLifetime(incoming, outgoing, upstream);
      incoming.pipe(upstream);
    },
  );

  let stopping = false;
  /** @type {(signal: NodeJS.Signals) => void} */
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain Node entry, intentionally runnable without a TypeScript loader
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    proxy.close();
    if (app.exitCode === null) app.kill(signal);
  };

  process.once('SIGINT', () => {
    stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    stop('SIGTERM');
  });
  app.once('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    proxy.close();
  });
  app.once('exit', (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal === null ? 1 : 0);
      proxy.close();
    }
  });
  process.once('exit', () => {
    rmSync(certificateDirectory, { recursive: true, force: true });
  });

  proxy.listen(publicPort, '127.0.0.1', () => {
    process.stdout.write(`${label} production fixture listening on ${publicUrl.origin}\n`);
  });
}
