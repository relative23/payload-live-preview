/**
 * One production transport at a time, either direct or through the existing
 * local TLS fixture proxy. These are HTTP tests, not component-SSR proofs.
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const fixtures = {
  astro: { directory: 'astro-hybrid', port: 4377, start: 'npm run start' },
  nextjs: {
    directory: 'nextjs-payload',
    port: 4374,
    start: 'npm run start -- --hostname 127.0.0.1 --port 4374',
  },
  sveltekit: { directory: 'sveltekit-payload', port: 4375, start: 'node build/index.js' },
  nuxt: { directory: 'nuxt-payload', port: 4376, start: 'node .output/server/index.mjs' },
} as const;
const name = process.env['PLP_LIFETIME_FRAMEWORK'];
if (name === undefined || !Object.hasOwn(fixtures, name)) {
  throw new Error('Set PLP_LIFETIME_FRAMEWORK to astro, nextjs, sveltekit or nuxt.');
}
const fixture = fixtures[name as keyof typeof fixtures];
const transport = process.env['PLP_LIFETIME_TRANSPORT'] ?? 'direct';
if (!['direct', 'tls'].includes(transport)) {
  throw new Error('PLP_LIFETIME_TRANSPORT must be direct or tls.');
}
const tls = transport === 'tls';
if (tls && name !== 'nextjs' && name !== 'sveltekit') {
  throw new Error('The TLS fixture proxy exists only for nextjs and sveltekit.');
}
const outputRoot = process.env['PLP_LIFETIME_RESULTS'] ?? 'test-results/hardening/h14-native';
// NextURL canonicalizes every loopback literal to localhost. Use that same
// authority on the wire instead of weakening the endpoint's origin check.
const origin = tls
  ? `https://localhost:${name === 'nextjs' ? 4274 : 4275}`
  : `http://${name === 'nextjs' ? 'localhost' : '127.0.0.1'}:${fixture.port}`;
if (tls) {
  process.env['PLP_LIFETIME_CERTIFICATE'] = resolve(outputRoot, name, 'localhost-certificate.pem');
}
// Inherited by workers and the server, never serialized into a report or URL.
process.env['PLP_LIFETIME_PROBE_KEY'] ??= randomBytes(32).toString('hex');

export default defineConfig({
  testDir: './tests/e2e/lifetime',
  outputDir: `${outputRoot}/${name}/${transport}/results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  failOnFlakyTests: true,
  timeout: 15_000,
  reporter: [
    ['list'],
    ['./scripts/playwright-zero-skip-reporter.ts'],
    ['json', { outputFile: `${outputRoot}/${name}/${transport}/report.json` }],
  ],
  // The self-signed certificate is generated for this fixture. Raw socket
  // probes additionally trust that exact certificate, not arbitrary TLS peers.
  use: { baseURL: origin, trace: 'off', ignoreHTTPSErrors: tls },
  projects: [{ name: `${name}-${transport}` }],
  webServer: {
    name: `${name}-${transport}-production`,
    cwd: tls ? '.' : `examples/${fixture.directory}`,
    command: tls
      ? `node scripts/${name === 'nextjs' ? 'next' : 'sveltekit'}-production-fixture.mjs`
      : `npm run build && ${fixture.start}`,
    env: {
      // Playwright inherits process.env. Do not copy credentials into config:
      // its JSON reporter serializes explicit webServer.env entries.
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(fixture.port),
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: String(fixture.port),
      ORIGIN: origin,
      ...(tls ? { PLP_NEXT_ORIGIN: origin, PLP_SVELTE_ORIGIN: origin } : {}),
    },
    url: `${origin}/${name === 'astro' ? 'bench' : 'admin.html'}`,
    ignoreHTTPSErrors: tls,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
