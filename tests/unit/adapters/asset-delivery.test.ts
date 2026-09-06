import { describe, expect, it } from 'vitest';
import { createRuntimeAssetRoute } from '@adapters/nextjs/asset-route';
import { createRuntimeAssetRoute as sveltekitAssetRoute } from '@adapters/sveltekit/asset-route';
import { createRuntimeAssetRoute as nuxtAssetRoute } from '@adapters/nuxt/asset-route';
import { livePreviewScriptProps } from '@adapters/nextjs/adapter';
import {
  ASSET_CACHE_CONTROL,
  DEFAULT_ASSET_PATH,
  runtimeAsset,
  runtimeAssetResponse,
} from '@adapters/shared/runtime-asset';
import { RUNTIME_CONTENT_HASH, RUNTIME_INTEGRITY, RUNTIME_SOURCE } from '@inline/runtime.generated';
import { LEAN_RUNTIME } from '@/lean';

/**
 * `delivery: 'asset'` is a promise about bytes: the page carries a bootstrap
 * and not the runtime, and the runtime it fetches is cacheable forever because
 * its name is its hash. Both halves are held here.
 */

const ADMIN = 'https://admin.example.com';
const base = { allowedOrigins: [ADMIN], mergeDepth: 1 } as const;

describe('the runtime asset', () => {
  it('names itself after its contents, under the default mount path', () => {
    const asset = runtimeAsset();

    expect(asset.fileName).toBe(`runtime.${RUNTIME_CONTENT_HASH}.js`);
    expect(asset.urlPath).toBe(`${DEFAULT_ASSET_PATH}/${asset.fileName}`);
    expect(asset.integrity).toBe(RUNTIME_INTEGRITY);
    expect(asset.source).toBe(RUNTIME_SOURCE);
  });

  it('describes the lean artifact when that is the one being served', () => {
    const asset = runtimeAsset({ runtime: LEAN_RUNTIME });

    expect(asset.source).toBe(LEAN_RUNTIME.source);
    expect(asset.integrity).toBe(LEAN_RUNTIME.integrity);
    expect(asset.fileName).not.toBe(runtimeAsset().fileName);
  });

  it.each([
    ['/app', '/app/runtime.'],
    ['app/', '/app/runtime.'],
    ['//app//', '/app/runtime.'],
    ['/', '/runtime.'],
    // The path is the consumer's, so trimming it may not backtrack: the
    // expression this replaced cost quadratic time on this row.
    [`${'/'.repeat(50_000)}app${'/'.repeat(50_000)}`, '/app/runtime.'],
  ])('mounts at %s as %s…', (assetPath, expected) => {
    expect(runtimeAsset({ assetPath }).urlPath.startsWith(expected)).toBe(true);
  });
});

describe('serving it', () => {
  it('answers with the bytes, cacheable for a year because the name is the hash', async () => {
    const asset = runtimeAsset();

    const response = runtimeAssetResponse(`https://site.example.com${asset.urlPath}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(ASSET_CACHE_CONTROL);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe(RUNTIME_SOURCE);
  });

  it('still answers through a cache-busting query string', () => {
    expect(runtimeAssetResponse(`${runtimeAsset().urlPath}?v=2`).status).toBe(200);
  });

  it('refuses a name from another build rather than serving these bytes under it', () => {
    // The whole point of `immutable`: one name, one set of bytes, forever.
    const response = runtimeAssetResponse('/payload-live-preview/runtime.0000000000000000.js');

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('is mounted wherever the route file sits, and checks only the name', () => {
    const asset = runtimeAsset();

    expect(runtimeAssetResponse(`/elsewhere/${asset.fileName}`).status).toBe(200);
  });

  it('is a route handler that takes the request Next.js hands it', async () => {
    const { GET } = createRuntimeAssetRoute();

    const response = GET(new Request(`https://site.example.com${runtimeAsset().urlPath}`));

    expect(await response.text()).toBe(RUNTIME_SOURCE);
  });

  it("is the same answer in every framework, in each one's own route shape", async () => {
    // Next re-exports `GET` from a route file, SvelteKit does the same but is
    // handed an event, and Nitro hands a handler the event's web request. What
    // they answer with must not depend on which of the three asked.
    const url = `https://site.example.com${runtimeAsset().urlPath}`;

    const responses = [
      createRuntimeAssetRoute().GET(new Request(url)),
      sveltekitAssetRoute().GET({ request: new Request(url) }),
      nuxtAssetRoute()(new Request(url)),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe(ASSET_CACHE_CONTROL);
      expect(await response.text()).toBe(RUNTIME_SOURCE);
    }
    expect(
      sveltekitAssetRoute().GET({ request: new Request('https://site.example.com/nope.js') })
        .status,
    ).toBe(404);
    expect(nuxtAssetRoute()(new Request('https://site.example.com/nope.js')).status).toBe(404);
  });

  it('serves the artifact the page was configured with', async () => {
    const { GET } = createRuntimeAssetRoute({ runtime: LEAN_RUNTIME });
    const lean = runtimeAsset({ runtime: LEAN_RUNTIME });

    const response = GET(new Request(`https://site.example.com${lean.urlPath}`));

    expect(await response.text()).toBe(LEAN_RUNTIME.source);
    // And not under the full runtime's name, which it no longer serves.
    expect(GET(new Request(`https://site.example.com${runtimeAsset().urlPath}`)).status).toBe(404);
  });
});

describe('what the page carries', () => {
  it('carries the runtime itself by default', () => {
    const { __html } = livePreviewScriptProps(base).dangerouslySetInnerHTML;

    expect(__html).toContain(RUNTIME_SOURCE);
  });

  it('carries the bootstrap, the asset URL and its integrity instead', () => {
    const { __html } = livePreviewScriptProps({
      ...base,
      delivery: 'asset',
    }).dangerouslySetInnerHTML;

    expect(__html).not.toContain(RUNTIME_SOURCE);
    expect(__html).toContain(runtimeAsset().urlPath);
    expect(__html).toContain(RUNTIME_INTEGRITY);
    // The configuration still travels in the page: the asset stays identical
    // for every site on this package version, and so carries none of it.
    expect(__html).toContain(ADMIN);
    expect(__html.length).toBeLessThan(RUNTIME_SOURCE.length / 10);
  });

  it('points at the mount path it was given', () => {
    const { __html } = livePreviewScriptProps({
      ...base,
      delivery: 'asset',
      assetPath: '/base/live-preview',
    }).dangerouslySetInnerHTML;

    expect(__html).toContain(`/base/live-preview/${runtimeAsset().fileName}`);
  });
});
