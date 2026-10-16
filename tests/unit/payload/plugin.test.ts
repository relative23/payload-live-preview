/**
 * The Payload config plugin is tested as a structural transform so the same
 * runtime code covers Payload 2 and 3 without importing either package.
 */
import { describe, expect, it } from 'vitest';
import { livePreview } from '@/payload/plugin';
import type { LivePreviewUrlArgs } from '@/payload/index';

const BASE = 'https://site.example';

type UrlCallback = (args: LivePreviewUrlArgs) => string;

interface TestLivePreviewConfig {
  breakpoints?: {
    name: string;
    label: string;
    width: number | string;
    height: number | string;
  }[];
  collections?: string[];
  globals?: string[];
  openByDefault?: boolean;
  url?: string | UrlCallback;
}

interface TestEntityConfig {
  admin?: { livePreview?: TestLivePreviewConfig };
  fields: unknown[];
  slug: string;
}

interface TestConfig {
  admin: {
    dateFormat?: string;
    livePreview: TestLivePreviewConfig;
  };
  collections: TestEntityConfig[];
  globals: TestEntityConfig[];
}

function config(): TestConfig {
  return {
    admin: {
      dateFormat: 'yyyy-MM-dd',
      livePreview: {
        collections: ['articles'],
        globals: ['navigation'],
        openByDefault: true,
      },
    },
    collections: [
      { slug: 'articles', fields: [] },
      { slug: 'posts', fields: [] },
      { slug: 'users', admin: { livePreview: { url: '/users-preview' } }, fields: [] },
    ],
    globals: [
      { slug: 'navigation', fields: [] },
      { slug: 'homepage', fields: [] },
    ],
  };
}

describe('Payload live preview config plugin', () => {
  it('adds mapped collections, globals, breakpoints and one URL callback without mutating input', () => {
    const input = config();
    const breakpoints = [{ name: 'mobile', label: 'Mobile', width: 390, height: '844px' }] as const;
    const plugin = livePreview({
      baseUrl: BASE,
      collections: { posts: ({ data }) => `/posts/${String(data['slug'])}` },
      globals: { homepage: '/' },
      breakpoints,
    });

    const output = plugin(input);

    expect(output).not.toBe(input);
    expect(output.admin).not.toBe(input.admin);
    expect(output.admin.dateFormat).toBe('yyyy-MM-dd');
    expect(output.admin.livePreview.openByDefault).toBe(true);
    expect(output.admin.livePreview.collections).toEqual(['articles', 'posts']);
    expect(output.admin.livePreview.globals).toEqual(['navigation', 'homepage']);
    expect(output.admin.livePreview.breakpoints).toEqual(breakpoints);
    expect(output.admin.livePreview.breakpoints).not.toBe(breakpoints);
    expect(output.admin.livePreview.breakpoints?.[0]).not.toBe(breakpoints[0]);
    expect(input.admin.livePreview).not.toHaveProperty('url');

    const url = output.admin.livePreview.url;
    expect(typeof url).toBe('function');
    if (typeof url !== 'function') throw new Error('plugin did not install a URL callback');
    expect(url({ data: { slug: 'hello' }, collectionConfig: { slug: 'posts' } })).toBe(
      `${BASE}/posts/hello?preview=true`,
    );
    expect(url({ data: {}, globalConfig: { slug: 'homepage' } })).toBe(`${BASE}/?preview=true`);
  });

  it('uses Payload 2 documentInfo and preserves breakpoints when the plugin omits them', () => {
    const input: TestConfig = {
      ...config(),
      admin: {
        livePreview: {
          breakpoints: [{ name: 'wide', label: 'Wide', width: 1440, height: 900 }],
        },
      },
    };
    const output = livePreview({
      baseUrl: BASE,
      collections: { posts: '/journal' },
      globals: { homepage: '/' },
    })(input);
    const url = output.admin.livePreview.url;
    if (typeof url !== 'function') throw new Error('plugin did not install a URL callback');

    expect(url({ data: {}, documentInfo: { collection: { slug: 'posts' } }, locale: 'en' })).toBe(
      `${BASE}/journal?preview=true`,
    );
    expect(url({ data: {}, documentInfo: { global: { slug: 'homepage' } } })).toBe(
      `${BASE}/?preview=true`,
    );
    expect(output.admin.livePreview.breakpoints).toEqual(input.admin.livePreview.breakpoints);
  });

  it('creates missing config branches and keeps mapped slugs that another plugin may add later', () => {
    const output = livePreview({
      baseUrl: BASE,
      collections: { futurePosts: '/future' },
      globals: { futureHomepage: '/' },
      breakpoints: [],
    })({});
    const configured = output as {
      admin: { livePreview: TestLivePreviewConfig };
    };

    expect(configured.admin.livePreview.collections).toEqual(['futurePosts']);
    expect(configured.admin.livePreview.globals).toEqual(['futureHomepage']);
    expect(configured.admin.livePreview.breakpoints).toEqual([]);
    expect(configured.admin.livePreview.url).toEqual(expect.any(Function));
  });

  it('deduplicates root entity lists without changing their first-seen order', () => {
    const input = config();
    input.admin.livePreview.collections = ['posts', 'articles', 'posts'];
    input.admin.livePreview.globals = ['homepage', 'navigation', 'homepage'];

    const output = livePreview({
      baseUrl: BASE,
      collections: { posts: '/posts', products: '/products' },
      globals: { homepage: '/', footer: '/footer' },
    })(input);

    expect(output.admin.livePreview.collections).toEqual(['posts', 'articles', 'products']);
    expect(output.admin.livePreview.globals).toEqual(['homepage', 'navigation', 'footer']);
    expect(input.admin.livePreview.collections).toEqual(['posts', 'articles', 'posts']);
    expect(input.admin.livePreview.globals).toEqual(['homepage', 'navigation', 'homepage']);
  });

  it('is idempotent when Payload reapplies the same plugin instance', () => {
    const plugin = livePreview({
      baseUrl: BASE,
      collections: { posts: '/posts' },
      globals: { homepage: '/' },
    });

    const once = plugin(config());
    const twice = plugin(once);

    expect(twice.admin.livePreview.collections).toEqual(['articles', 'posts']);
    expect(twice.admin.livePreview.globals).toEqual(['navigation', 'homepage']);
    expect(twice.admin.livePreview.url).toBe(once.admin.livePreview.url);
  });

  it('refuses to hide an existing root URL callback', () => {
    const input = config();
    const previous = () => 'https://old.example/';
    input.admin.livePreview = { ...input.admin.livePreview, url: previous };

    expect(() => livePreview({ baseUrl: BASE, globals: { homepage: '/' } })(input)).toThrow(
      /admin\.livePreview\.url/u,
    );
    expect(input.admin.livePreview.url).toBe(previous);
  });

  it('cannot police a URL callback written by a later config transform', () => {
    const configured = livePreview({ baseUrl: BASE, globals: { homepage: '/' } })(config());
    const later = () => 'https://later.example/';

    const output = {
      ...configured,
      admin: {
        ...configured.admin,
        livePreview: { ...configured.admin.livePreview, url: later },
      },
    };

    expect(output.admin.livePreview.url).toBe(later);
  });

  it('refuses a selected collection or global URL but leaves an unrelated one alone', () => {
    const selected = config();
    selected.collections[1] = {
      slug: 'posts',
      admin: { livePreview: { url: '/posts-preview' } },
      fields: [],
    };
    expect(() =>
      livePreview({ baseUrl: BASE, collections: { posts: '/posts' } })(selected),
    ).toThrow(/collection "posts"/u);

    const selectedGlobal = config();
    selectedGlobal.globals[1] = {
      slug: 'homepage',
      admin: { livePreview: { url: '/homepage-preview' } },
      fields: [],
    };
    expect(() =>
      livePreview({ baseUrl: BASE, globals: { homepage: '/' } })(selectedGlobal),
    ).toThrow(/global "homepage"/u);

    const unrelated = config();
    const output = livePreview({ baseUrl: BASE, globals: { homepage: '/' } })(unrelated);

    expect(output.collections[2]?.admin?.livePreview?.url).toBe('/users-preview');
    expect(unrelated.collections[2]?.admin?.livePreview?.url).toBe('/users-preview');
  });

  it('does not mint or accept a signing secret in the cross-version plugin', () => {
    const plugin = livePreview({ baseUrl: BASE, globals: { homepage: '/' } });
    const output = plugin(config());
    const url = output.admin.livePreview.url;
    if (typeof url !== 'function') throw new Error('plugin did not install a URL callback');

    expect(url({ data: {}, globalConfig: { slug: 'homepage' } })).not.toContain('previewToken=');
  });
});
