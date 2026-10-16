/**
 * The native lifetime and body-limit cases (`tests/e2e/lifetime`, and
 * `tests/e2e/lifetime-h2` for an HTTP/2 client) against hosts that are not a
 * framework fixture: the Web-API endpoint on Node, Deno and Bun, and behind a
 * proxy. `lifetime-proxy` holds a proxy to what it was measured to do with an
 * unfinished upload and a body over its own limit; `lifetime-browser` asks from a
 * page's fetch in each engine. HTTP tests, not component-SSR proofs.
 *
 * Setup: `npm run build`, then `npx tsx tests/fixtures/web-hosts/build.ts`, and a
 * certificate for the TLS hosts: `mkcert -cert-file test-results/hosts-certs/cert.pem
 * -key-file test-results/hosts-certs/key.pem localhost 127.0.0.1`. Docker runs Deno,
 * Bun and the proxies, one container each, on the host network.
 *
 *   PLP_HOST=node|deno|bun|deno-h2                  the host itself
 *   PLP_HOST=nginx-buffered|nginx-streaming|caddy|traefik   a proxy in front of Node
 *   PLP_HOST=nginx-limited                          nginx with a body limit of its own
 *   PLP_HOST_PROTOCOL=h1|h2                         the client protocol, for a proxy
 *   PLP_HOST_BROWSERS=chromium,firefox,webkit       the page-side runs instead (HTTP/2 to a TLS host)
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const bundle = resolve(process.env['PLP_HOSTS_BUNDLE'] ?? 'test-results/web-hosts');
const certificates = resolve(process.env['PLP_HOSTS_CERTS'] ?? 'test-results/hosts-certs');
const proxies = resolve('tests/fixtures/web-hosts/proxies');
const CA = resolve(process.env['HOME'] ?? '', '.local/share/mkcert/rootCA.pem');
const DENO = 'deno run --allow-net --allow-env --allow-read /app/deno.mjs';

const docker = (name: string, image: string, command: string, extra = ''): string =>
  `docker rm -f plp-host-${name} >/dev/null 2>&1; ` +
  `docker run --rm --init --name plp-host-${name} --network host ` +
  `-e PLP_LIFETIME_PROBE_KEY -e PAYLOAD_ADMIN_ORIGIN ${extra} ${image} ${command}`;
const app = (port: number): string => `-e PORT=${String(port)} -v ${bundle}:/app:ro`;
const certs = `-v ${certificates}:/certs:ro -v ${proxies}:/proxies:ro`;

interface Server {
  readonly command: string;
  readonly url: string;
}
/**
 * What a proxy was measured to do with an upload the client has not finished,
 * per client protocol. `buffers`: nothing reaches the upstream until the body is
 * whole. `holds-answer`: the request is forwarded at once and the upstream's
 * answer reaches the client only after the upload ends.
 */
type Upload = 'buffers' | 'holds-answer';
interface Host {
  /** What the client connects to. */
  readonly origin: string;
  /** TLS in front, so the client may speak HTTP/2. */
  readonly secure: boolean;
  readonly upload?: Partial<Record<'h1' | 'h2', Upload>>;
  /** The proxy carries a body limit of its own, above the endpoint's. */
  readonly limit?: boolean;
  /** …and answers a declared length over it before the endpoint is asked anything. */
  readonly refusesFirst?: boolean;
  /** From this many bytes up, a page's fetch gets a 413 every time, never a reset or a 502. */
  readonly refusesWholeFrom?: number;
  readonly servers: readonly Server[];
}

const node: Server = { command: `node ${bundle}/node.mjs`, url: 'http://127.0.0.1:4393/healthz' };
const behind = (
  name: string,
  image: string,
  port: number,
  command: string,
  traits: Pick<Host, 'upload' | 'limit' | 'refusesFirst' | 'refusesWholeFrom'> = {},
): Host => ({
  origin: `https://localhost:${String(port)}`,
  secure: true,
  ...traits,
  servers: [
    node,
    {
      command: docker(name, image, command, certs),
      url: `https://localhost:${String(port)}/healthz`,
    },
  ],
});

// The file provider's watcher needs inotify handles a container may not have.
const traefik = (port: number, file: string): string =>
  `--entrypoints.edge.address=:${String(port)} --providers.file.filename=/proxies/${file} ` +
  '--providers.file.watch=false --log.level=ERROR';

const hosts: Record<string, Host> = {
  node: { origin: 'http://127.0.0.1:4393', secure: false, servers: [node] },
  deno: {
    origin: 'http://127.0.0.1:4391',
    secure: false,
    refusesWholeFrom: 0,
    servers: [
      {
        command: docker('deno', 'denoland/deno:alpine', DENO, app(4391)),
        url: 'http://127.0.0.1:4391/healthz',
      },
    ],
  },
  bun: {
    origin: 'http://127.0.0.1:4392',
    secure: false,
    refusesWholeFrom: 0,
    servers: [
      {
        command: docker('bun', 'oven/bun:alpine', 'bun /app/bun.mjs', app(4392)),
        url: 'http://127.0.0.1:4392/healthz',
      },
    ],
  },
  // Deno terminates HTTP/2 itself when it has a certificate.
  'deno-h2': {
    origin: 'https://localhost:4394',
    secure: true,
    refusesWholeFrom: 0,
    servers: [
      {
        command: docker(
          'deno-h2',
          'denoland/deno:alpine',
          DENO,
          `${app(4394)} ${certs} -e PLP_HOST_CERT=/certs/cert.pem -e PLP_HOST_KEY=/certs/key.pem`,
        ),
        url: 'https://localhost:4394/healthz',
      },
    ],
  },
  'nginx-buffered': behind(
    'nginx-buffered',
    'nginx:1.27-alpine',
    4395,
    "nginx -c /proxies/nginx-buffered.conf -g 'daemon off;'",
    { upload: { h1: 'buffers', h2: 'buffers' } },
  ),
  'nginx-streaming': behind(
    'nginx-streaming',
    'nginx:1.27-alpine',
    4397,
    "nginx -c /proxies/nginx-streaming.conf -g 'daemon off;'",
  ),
  caddy: behind('caddy', 'caddy:2-alpine', 4396, 'caddy run --config /proxies/Caddyfile', {
    upload: { h1: 'holds-answer' },
  }),
  traefik: behind('traefik', 'traefik:v3.3', 4398, traefik(4398, 'traefik-dynamic.yml'), {
    upload: { h1: 'holds-answer' },
  }),
  'nginx-limited': behind(
    'nginx-limited',
    'nginx:1.27-alpine',
    4399,
    "nginx -c /proxies/nginx-limited.conf -g 'daemon off;'",
    { limit: true, refusesFirst: true, refusesWholeFrom: 256 * 1024 },
  ),
};

const name = process.env['PLP_HOST'];
const host = name === undefined ? undefined : hosts[name];
if (name === undefined || host === undefined) {
  throw new Error(`Set PLP_HOST to one of ${Object.keys(hosts).join(', ')}.`);
}
const protocol = process.env['PLP_HOST_PROTOCOL'] ?? (name === 'deno-h2' ? 'h2' : 'h1');
if (!['h1', 'h2'].includes(protocol) || (protocol === 'h2' && !host.secure)) {
  throw new Error('PLP_HOST_PROTOCOL must be h1, or h2 for a host with TLS.');
}
const outputRoot = process.env['PLP_HOSTS_RESULTS'] ?? 'test-results/hosts';
// Inherited by workers and the servers, never serialized into a report or URL.
process.env['PLP_LIFETIME_PROBE_KEY'] ??= randomBytes(32).toString('hex');
process.env['PAYLOAD_ADMIN_ORIGIN'] = host.origin;
// Deno fails the body stream of a dropped upload instead of aborting the signal.
if (name.startsWith('deno')) process.env['PLP_LIFETIME_UPLOAD_ABORT'] = 'body-error';
if (host.secure) {
  process.env['PLP_HOST_CA'] ??= CA;
  process.env['PLP_LIFETIME_CERTIFICATE'] ??= CA;
}

// Which specs apply follows what the host was measured to do. A proxy that
// answers a declared oversize body itself, or holds back what the endpoint
// answers, has no early refusal of the endpoint's to observe; a half-sent upload
// the proxy buffers never reaches the endpoint at all.
const upload = host.upload?.[protocol as 'h1' | 'h2'];
const specs = [protocol === 'h2' ? 'lifetime-h2/**/*.spec.ts' : 'lifetime/**/*.spec.ts'];
if (upload !== undefined) specs.push('lifetime-proxy/fragment-proxy-upload.spec.ts');
if (host.refusesFirst === true && protocol === 'h1') {
  specs.push('lifetime-proxy/fragment-large-refusal.spec.ts');
}
if (upload !== undefined) process.env['PLP_HOST_UPLOAD'] = upload;
const notApplicable =
  upload === 'buffers'
    ? /incomplete upload|still being uploaded/u
    : upload === 'holds-answer'
      ? /still being uploaded/u
      : undefined;

const engines = (process.env['PLP_HOST_BROWSERS'] ?? '')
  .split(',')
  .filter((engine) => engine !== '');
if (host.refusesWholeFrom !== undefined) {
  process.env['PLP_HOST_REFUSES_WHOLE_FROM'] = String(host.refusesWholeFrom);
}
const api = {
  name: `host-${name}-${protocol}`,
  testMatch: specs,
  ...(upload !== undefined || host.limit === true ? { testIgnore: /fragment-early-refusal/u } : {}),
  ...(notApplicable === undefined ? {} : { grepInvert: notApplicable }),
};

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `${outputRoot}/${name}-${protocol}/results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  failOnFlakyTests: true,
  timeout: 15_000,
  reporter: [
    ['list'],
    ['./scripts/playwright-zero-skip-reporter.ts'],
    ['json', { outputFile: `${outputRoot}/${name}-${protocol}/report.json` }],
  ],
  use: { baseURL: host.origin, trace: 'off', ignoreHTTPSErrors: host.secure },
  // The page-side runs speak whatever the browser negotiates: HTTP/2 to a host with TLS.
  projects:
    engines.length === 0
      ? [api]
      : engines.map((engine) => ({
          name: `${engine}-${name}`,
          testMatch: 'lifetime-browser/**/*.spec.ts',
          use: { browserName: engine as 'chromium' | 'firefox' | 'webkit' },
        })),
  webServer: host.servers.map((server, index) => ({
    name: `${name}-${String(index)}`,
    command: server.command,
    url: server.url,
    ignoreHTTPSErrors: host.secure,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 10_000 },
  })),
});
