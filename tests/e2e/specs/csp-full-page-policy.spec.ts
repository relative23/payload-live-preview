import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import {
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  mergeCspHeader,
} from '../../../src/security/csp';

/**
 * `manageCsp: 'full'` merges a nonce'd `script-src` into the page's own policy.
 * The nonce'd script has to run, and what the page's policy let run has to keep
 * running: CSP 2 and later ignore `'unsafe-inline'` once a nonce is in the same
 * list. The header here is what the merge builds from full mode's additions
 * (the adapter conformance suite pins that the adapters send it), and each
 * engine reports which of the page's script and the nonce'd one ran.
 */

const NONCE = 'c3BlYy1ub25jZS0xMjM0NQ';
const PAGE =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<script>document.documentElement.dataset.page = "ran"</script>' +
  `<script nonce="${NONCE}">document.documentElement.dataset.runtime = "ran"</script>` +
  '</head><body></body></html>';

/** The additions `buildPreviewCsp` makes in 'full' mode without `strictDynamic`. */
const FULL_MODE = {
  'frame-ancestors': buildFrameAncestors({ self: true, origins: [] }),
  'script-src': buildScriptSrcWithNonce(NONCE, { self: true, strictDynamic: false }),
};

interface PagePolicy {
  /** The page's own policy. */
  readonly policy: string;
  /** Whether that policy lets the page's own inline script run. */
  readonly pageRuns: boolean;
}

const PAGE_POLICIES: readonly PagePolicy[] = [
  // 'unsafe-inline' on script-src, then through the default-src fallback.
  { policy: "script-src 'self' 'unsafe-inline'", pageRuns: true },
  { policy: "default-src 'self' 'unsafe-inline'", pageRuns: true },
  // A script-src-elem of the page's own decides for script elements: the nonce has to reach it,
  // and where it allows inline scripts itself, the page's script keeps running there.
  { policy: "script-src-elem 'self'; script-src 'self'", pageRuns: false },
  { policy: "script-src-elem 'self' 'unsafe-inline'; script-src 'self'", pageRuns: true },
];

let server: Server | undefined;
let origin = '';

test.beforeAll(async () => {
  const listening = createServer((incoming, outgoing) => {
    const index = Number(new URL(incoming.url ?? '/', 'http://localhost').searchParams.get('p'));
    const page = PAGE_POLICIES[index];
    if (page === undefined) {
      outgoing.writeHead(404).end();
      return;
    }
    outgoing.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': mergeCspHeader(page.policy, FULL_MODE),
    });
    outgoing.end(PAGE);
  });
  server = listening;
  await new Promise<void>((done) => listening.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${String((listening.address() as AddressInfo).port)}`;
});

test.afterAll(async () => {
  await new Promise<void>((done) => {
    if (server === undefined) done();
    else server.close(() => done());
  });
});

PAGE_POLICIES.forEach(({ policy, pageRuns }, index) => {
  const pageScript = pageRuns ? 'runs too' : 'stays blocked, as that policy says';
  test(`under "${policy}" the nonce'd script runs and the page's inline script ${pageScript}`, async ({
    page,
  }) => {
    const response = await page.goto(`${origin}/?p=${String(index)}`);
    expect(response?.headers()['content-security-policy']).toBe(mergeCspHeader(policy, FULL_MODE));

    const ran = await page.evaluate(() => {
      const { dataset } = document.documentElement;
      return { page: dataset['page'], runtime: dataset['runtime'] };
    });

    expect(ran).toEqual({ page: pageRuns ? 'ran' : undefined, runtime: 'ran' });
  });
});
