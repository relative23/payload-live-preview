import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * What a page costs someone who is not an editor.
 *
 * The interesting number about this package is not how large the runtime is
 * but who receives it, and that is decided by the delivery — not by the
 * adapter. Three outcomes exist, and each fixture below is pinned to the one
 * its setup actually produces:
 *
 * - `nothing`   — something ran per request, saw no preview intent, and
 *                 injected neither runtime nor bootstrap.
 * - `bootstrap` — a statically built page, or one whose script is rendered for
 *                 every visitor, carries the few hundred bytes that check for a
 *                 preview context. The runtime itself is never fetched.
 * - `runtime`   — the full runtime ships to everyone. Honest, and the reason
 *                 the other two options exist.
 *
 * A page that is not gated is not a defect here; being wrong about which case
 * a setup falls into would be.
 */

const RUNTIME_MARKER = 'LP0101';
const BOOTSTRAP_URL = /runtime\.[0-9a-f]{16}\.js/u;

type Carries = 'nothing' | 'bootstrap' | 'runtime';

interface Fixture {
  readonly name: string;
  readonly app: string;
  readonly path: string;
  readonly carries: Carries;
  /** Whether `data-payload-*` attributes are in the public markup. */
  readonly bindings: boolean;
  readonly why: string;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'Astro, static build, mode: loader',
    app: 'http://localhost:4173',
    path: '/',
    carries: 'bootstrap',
    bindings: true,
    why: 'a static page has no request to decide for, so the bootstrap decides in the browser',
  },
  {
    name: 'Astro, static build, mode: inline',
    app: 'http://localhost:4182',
    path: '/',
    carries: 'runtime',
    bindings: true,
    why: 'nothing decides and nothing is deferred: this is what the other rows are measured against',
  },
  {
    name: 'Astro, middleware',
    app: 'http://localhost:4183',
    path: '/',
    carries: 'nothing',
    bindings: true,
    why: 'the middleware runs per request and sees no intent',
  },
  {
    name: 'Next.js, script in the root layout',
    app: 'http://localhost:4174',
    path: '/',
    carries: 'runtime',
    bindings: true,
    why: 'a layout renders for every visitor; Next middleware cannot inject into a body, so gating the runtime means delivery: asset',
  },
  {
    name: 'Next.js, delivery: asset',
    app: 'http://localhost:4174',
    path: '/asset',
    carries: 'bootstrap',
    bindings: true,
    why: 'the same layout, now rendering a bootstrap the visitor never redeems',
  },
  {
    name: 'Nuxt, Nitro plugin, delivery: asset',
    app: 'http://localhost:4176',
    path: '/',
    carries: 'nothing',
    bindings: true,
    why: 'the plugin decides per request, so a public visitor gets not even the bootstrap',
  },
  {
    name: 'SvelteKit, handle, gated bindings',
    app: 'http://localhost:4175',
    path: '/',
    carries: 'nothing',
    bindings: false,
    why: 'the handle decides per request and createPreviewBindings withholds the attributes too',
  },
];

async function body(request: APIRequestContext, url: string): Promise<string> {
  const response = await request.get(url);
  expect(response.status(), url).toBe(200);
  return response.text();
}

/**
 * Registered once per fixture, by index rather than in a loop: the test policy
 * wants the suite's shape readable without running it (scripts/test-policy.ts).
 */
function registerFixture(fixture: Fixture): void {
  test(`a public response carries ${fixture.carries} — ${fixture.name}`, async ({ request }) => {
    const html = await body(request, `${fixture.app}${fixture.path}`);

    expect(html.includes(RUNTIME_MARKER), fixture.why).toBe(fixture.carries === 'runtime');
    expect(BOOTSTRAP_URL.test(html), fixture.why).toBe(fixture.carries === 'bootstrap');
    expect(html.includes('__LIVE_PREVIEW_CONFIG__'), fixture.why).toBe(
      fixture.carries !== 'nothing',
    );
    expect(/\sdata-payload-[a-z-]+="/u.test(html), fixture.why).toBe(fixture.bindings);
  });
}

registerFixture(FIXTURES[0]!);
registerFixture(FIXTURES[1]!);
registerFixture(FIXTURES[2]!);
registerFixture(FIXTURES[3]!);
registerFixture(FIXTURES[4]!);
registerFixture(FIXTURES[5]!);
registerFixture(FIXTURES[6]!);

test.describe('what a public response costs', () => {
  test('the bootstrap is a rounding error against the runtime it defers', async ({ request }) => {
    const asset = await body(request, 'http://localhost:4174/asset');
    const inline = await body(request, 'http://localhost:4174/');

    // Same fixture, same shell, one option apart: the runtime is about 97 KB
    // and the bootstrap a few hundred bytes, so the gap is the runtime.
    expect(inline.length - asset.length).toBeGreaterThan(90_000);
  });

  test('an unauthorized preview is a public response, byte for byte', async ({ request }) => {
    // Intent is not authorization (ADR 0006). The SvelteKit fixture is the
    // strict one: a request that claims to be a preview without a token bound
    // to its path gets the same bytes as a visitor who claimed nothing.
    const claimed = await body(request, 'http://localhost:4175/?preview=true');
    const plain = await body(request, 'http://localhost:4175/');

    expect(claimed).toBe(plain);
  });
});
