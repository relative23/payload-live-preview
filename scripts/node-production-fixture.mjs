/**
 * Native Node outputs build behind the same local TLS boundary.
 * Only the framework launch path differs; proxy cancellation and certificate
 * cleanup retain one implementation for the production consumers.
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTlsFront } from './tls-front.mjs';

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
  // The private listener sits below the ephemeral range (32768-60999), so an outbound connection cannot claim it.
  const internalPort = Number(
    process.env[`${prefix}_INTERNAL_PORT`] ??
      (isNuxt ? '14276' : isAstro ? '14277' : isHTML ? '14288' : isVue ? '14289' : '14275'),
  );
  // The mock admin is a page of the fixture itself. A run against a real admin names that
  // admin's HTTPS origin instead (playwright.real-payload.config.ts).
  const adminOrigin = process.env['PLP_PRODUCTION_ADMIN_ORIGIN'] ?? publicUrl.origin;
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    PAYLOAD_ADMIN_ORIGIN: adminOrigin,
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

  const proxy = startTlsFront({ label: `${label} production fixture`, publicUrl, internalPort });

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
}
