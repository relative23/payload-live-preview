import { describe, expect, it } from 'vitest';
import { buildLivePreviewUrl, type LivePreviewUrlArgs } from '@/payload/index';

const BASE = 'https://site.example';

function collectionArgs(slug: string, data: Record<string, unknown> = {}): LivePreviewUrlArgs {
  return { data, collectionConfig: { slug } };
}

function globalArgs(slug: string, data: Record<string, unknown> = {}): LivePreviewUrlArgs {
  return { data, globalConfig: { slug } };
}

describe('buildLivePreviewUrl — 1.0 behaviour', () => {
  const url = buildLivePreviewUrl({
    baseUrl: `${BASE}/`,
    collections: {
      services: ({ data }) =>
        typeof data['slug'] === 'string' ? `/services/${data['slug']}` : '/services',
    },
    globals: { homepage: '/', contact: ({ locale }) => `/${locale ?? 'de'}/contact` },
  });

  it('strips trailing slashes from the base and appends the preview parameter', () => {
    expect(url(globalArgs('homepage'))).toBe(`${BASE}/?preview=true`);
  });

  it('resolves a collection through its function resolver', () => {
    expect(url(collectionArgs('services', { slug: 'thai-massage' }))).toBe(
      `${BASE}/services/thai-massage?preview=true`,
    );
  });

  it('passes the normalised locale to the resolver', () => {
    const withLocale = buildLivePreviewUrl({
      baseUrl: BASE,
      globals: { contact: ({ locale }) => `/${locale ?? 'none'}/contact` },
    });
    expect(withLocale({ ...globalArgs('contact'), locale: 'en' })).toBe(
      `${BASE}/en/contact?preview=true`,
    );
    expect(withLocale({ ...globalArgs('contact'), locale: { code: 'de' } })).toBe(
      `${BASE}/de/contact?preview=true`,
    );
    expect(withLocale({ ...globalArgs('contact'), locale: '' })).toBe(
      `${BASE}/none/contact?preview=true`,
    );
  });

  it('falls back for an unmapped slug and for an empty resolver result', () => {
    expect(url(collectionArgs('unknown'))).toBe(`${BASE}/?preview=true`);
    const empty = buildLivePreviewUrl({ baseUrl: BASE, globals: { blank: () => '' } });
    expect(empty(globalArgs('blank'))).toBe(`${BASE}/?preview=true`);
  });

  it('honours a custom fallback and normalises a missing leading slash', () => {
    const custom = buildLivePreviewUrl({ baseUrl: BASE, fallback: 'de/start' });
    expect(custom(globalArgs('unmapped'))).toBe(`${BASE}/de/start?preview=true`);
  });

  it('merges the preview parameter into a path that already has a query', () => {
    const query = buildLivePreviewUrl({ baseUrl: BASE, globals: { g: '/p?a=1' } });
    expect(query(globalArgs('g'))).toBe(`${BASE}/p?a=1&preview=true`);
  });

  it('omits the parameter entirely when previewParam is null', () => {
    const bare = buildLivePreviewUrl({ baseUrl: BASE, globals: { g: '/p' }, previewParam: null });
    expect(bare(globalArgs('g'))).toBe(`${BASE}/p`);
  });

  it('prefers a matching collection over a global of the same name', () => {
    const both = buildLivePreviewUrl({
      baseUrl: BASE,
      collections: { shared: '/from-collection' },
      globals: { shared: '/from-global' },
    });
    expect(both(collectionArgs('shared'))).toBe(`${BASE}/from-collection?preview=true`);
    expect(both(globalArgs('shared'))).toBe(`${BASE}/from-global?preview=true`);
  });
});

describe('buildLivePreviewUrl — declining a document', () => {
  it('returns null when a resolver declines', () => {
    const url = buildLivePreviewUrl({
      baseUrl: BASE,
      collections: {
        services: ({ data }) =>
          typeof data['id'] === 'number' ? `/services/${String(data['id'])}` : null,
      },
    });

    expect(url(collectionArgs('services', { id: 73 }))).toBe(`${BASE}/services/73?preview=true`);
    // A draft without an id has no stable route yet — no iframe beats a wrong one.
    expect(url(collectionArgs('services', {}))).toBeNull();
  });

  it('treats a mapped null entry as a resolver, not as an absent one', () => {
    const url = buildLivePreviewUrl({
      baseUrl: BASE,
      collections: { users: null },
      globals: { users: '/should-not-be-reached' },
      fallback: '/home',
    });

    // `??`-style lookup would skip the null entry and fall through.
    expect(url(collectionArgs('users'))).toBeNull();
  });

  it('declines every unmapped document when the fallback is null', () => {
    const url = buildLivePreviewUrl({
      baseUrl: BASE,
      globals: { homepage: '/' },
      fallback: null,
    });

    expect(url(globalArgs('homepage'))).toBe(`${BASE}/?preview=true`);
    expect(url(globalArgs('contact-submissions'))).toBeNull();
    expect(url(collectionArgs('users'))).toBeNull();
  });

  it('keeps the empty string meaning "fall back", which is null only when the fallback is', () => {
    const toPath = buildLivePreviewUrl({ baseUrl: BASE, globals: { g: () => '' } });
    expect(toPath(globalArgs('g'))).toBe(`${BASE}/?preview=true`);

    const toNull = buildLivePreviewUrl({
      baseUrl: BASE,
      globals: { g: () => '' },
      fallback: null,
    });
    expect(toNull(globalArgs('g'))).toBeNull();
  });

  it('does not let an explicit null fallback decay into the default path', () => {
    const url = buildLivePreviewUrl({ baseUrl: BASE, fallback: null });
    expect(url(globalArgs('anything'))).not.toBe(`${BASE}/?preview=true`);
    expect(url(globalArgs('anything'))).toBeNull();
  });
});
