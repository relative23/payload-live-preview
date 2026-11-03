import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  createDocumentSession,
  type DocumentSession,
  type DocumentSessionOptions,
} from '@adapters/shared/document-session';
import { OriginDetector } from '@detection/origin';

/**
 * The rows of the ADR 0007 ledger whose default 3.0 changes say so once per
 * page in development (ADR 0026, 2026-11-03): a hook without `document`
 * (row 26), a hook without a merge deadline (row 27), an update without a
 * locale merged by a hook with one (row 31), and a detector that trusts the
 * referrer by default (row 22). `requireLocale` takes row 31's 3.0 behaviour
 * now. Nothing is said in production, and nothing where 3.0 changes nothing.
 */

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';

interface Doc extends Record<string, unknown> {
  id: string;
  title: string;
}

function post(message: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ADMIN,
      source: window.parent,
      data: { type: 'payload-live-preview', collectionSlug: 'pages', ...message },
    }),
  );
}

let urls: string[];
const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  await Promise.resolve();
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
    data: Record<string, unknown>;
  };
  return new Response(JSON.stringify(body.data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

const stops: (() => void)[] = [];
function open(extra: Partial<DocumentSessionOptions> = {}): DocumentSession<Doc> {
  const session = createDocumentSession<Doc>(
    { id: '1', title: 'One' },
    { serverURL: SERVER, allowedOrigins: [ADMIN], eventSourcePolicy: 'any', fetchFn, ...extra },
  );
  stops.push(session.subscribe(() => {}));
  return session;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

let warn: MockInstance<typeof console.warn>;
const said = (): string[] => warn.mock.calls.map(([message]) => String(message));

beforeEach(() => {
  urls = [];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('3.0 notices from a hook', () => {
  it('names the missing document and the missing deadline once per page, however many hooks', () => {
    open();
    open();
    expect(said()).toEqual([
      '[payload-live-preview] A hook without `document` merges any document; 3.0 requires it ' +
        '(ADR 0007, row 26).',
      '[payload-live-preview] A hook without `timeoutMs` waits for a merge; 3.0 sets a default, ' +
        '`0` keeps none (ADR 0007, row 27).',
    ]);
  });

  it('names each notice by a fixed key on the page, which every copy of the package shares', async () => {
    // Two copies on one page, possibly of different versions, must agree on
    // these strings, or each would print its own line.
    open({ document: { collection: 'pages', id: '1', locale: 'de' } });
    post({ data: { id: '1', title: 'No locale' } });
    await settle();
    open();
    new OriginDetector({ referrer: 'https://admin.example.com/admin' });
    const issued = (globalThis as Record<string, unknown>)['__payloadLivePreviewNotices'];
    expect([...(issued as Set<string>)].sort()).toEqual([
      'hook-deadline',
      'hook-document',
      'hook-locale',
      'origin-referrer',
    ]);
    expect(said()).toHaveLength(4);
  });

  it('says nothing about a hook that names both, including `timeoutMs: 0`', () => {
    open({ document: { collection: 'pages', id: '1' }, timeoutMs: 0 });
    open({ document: { global: 'header' }, timeoutMs: 5_000 });
    expect(said()).toEqual([]);
  });

  it('says nothing in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    open({ document: { collection: 'pages', id: '1', locale: 'de' } });
    post({ data: { id: '1', title: 'No locale' } });
    await settle();
    expect(urls).toHaveLength(1);
    expect(said()).toEqual([]);
  });
});

describe('an update without a locale, for a hook with one (row 31)', () => {
  const localized = { collection: 'pages', id: '1', locale: 'de' } as const;

  it('is merged in 2.x, and the hook says once that 3.0 leaves it alone', async () => {
    const session = open({ document: localized, timeoutMs: 0 });
    post({ data: { id: '1', title: 'No locale' } });
    await settle();
    post({ data: { id: '1', title: 'Still none' } });
    await settle();
    expect(urls).toHaveLength(2);
    expect(session.getSnapshot().data.title).toBe('Still none');
    expect(said()).toEqual([
      '[payload-live-preview] A hook for locale "de" merged an update without one; 3.0 skips ' +
        'it, as `requireLocale: true` does now (ADR 0007, row 31).',
    ]);
  });

  it('is left alone with `requireLocale: true`, as in 3.0, and nothing is said', async () => {
    const session = open({ document: localized, requireLocale: true, timeoutMs: 0 });
    post({ data: { id: '1', title: 'No locale' } });
    await settle();
    expect(urls).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', revision: 0 });
    post({ locale: 'de', data: { id: '1', title: 'German' } });
    await settle();
    expect(session.getSnapshot().data.title).toBe('German');
    expect(said()).toEqual([]);
  });

  it('still refuses another locale either way, and says nothing for a named one', async () => {
    open({ document: localized, timeoutMs: 0 });
    post({ locale: 'en', data: { id: '1', title: 'English' } });
    await settle();
    expect(urls).toEqual([]);
    open({ document: localized, requireLocale: true, timeoutMs: 0 });
    post({ locale: 'en', data: { id: '1', title: 'English' } });
    await settle();
    expect(urls).toEqual([]);
    expect(said()).toEqual([]);
  });

  it('changes nothing for a hook without a locale, with or without the opt-in', async () => {
    open({ document: { collection: 'pages', id: '1' }, requireLocale: true, timeoutMs: 0 });
    post({ data: { id: '1', title: 'No locale' } });
    await settle();
    expect(urls).toHaveLength(1);
    expect(said()).toEqual([]);
  });
});

describe('a detector that trusts the referrer by default (row 22)', () => {
  const referrer = 'https://admin.example.com/admin/collections/pages/1';

  it('says once that 3.0 stops trusting it', () => {
    new OriginDetector({ referrer });
    new OriginDetector({ referrer });
    expect(said()).toEqual([
      '[payload-live-preview] `new OriginDetector()` trusts the referrer unless ' +
        '`enableReferrerDetection` says so; 3.0 does not (ADR 0007, row 22).',
    ]);
  });

  it('says nothing where 3.0 changes nothing', () => {
    new OriginDetector({ referrer, enableReferrerDetection: true });
    new OriginDetector({ referrer, enableReferrerDetection: false });
    new OriginDetector({ referrer, additionalOrigins: [ADMIN] });
    new OriginDetector({ referrer: '' });
    expect(said()).toEqual([]);
  });

  it('says nothing in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    new OriginDetector({ referrer });
    expect(said()).toEqual([]);
  });
});
