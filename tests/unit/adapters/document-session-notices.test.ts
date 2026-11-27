import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  createDocumentSession,
  type DocumentSession,
  type DocumentSessionOptions,
} from '@adapters/shared/document-session';
import { OriginDetector } from '@detection/origin';

/**
 * The row of the ADR 0007 ledger whose default 3.0 still changes says so once
 * per page in development (ADR 0026, 2026-11-03): a hook without a merge
 * deadline (row 27). Nothing is said in production, and nothing where 3.0
 * changes nothing. Rows 22, 26 and 31 are done: a detector trusts a referrer
 * only when asked to, a hook names its document, and one with a locale leaves
 * alone an update that names none, each without a word.
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
    {
      document: 'any',
      serverURL: SERVER,
      allowedOrigins: [ADMIN],
      eventSourcePolicy: 'any',
      fetchFn,
      ...extra,
    },
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
  it('names the missing deadline once per page, however many hooks', () => {
    open();
    open();
    expect(said()).toEqual([
      '[payload-live-preview] A hook without `timeoutMs` waits for a merge; 3.0 sets a default, ' +
        '`0` keeps none (ADR 0007, row 27).',
    ]);
  });

  it('names the notice by a fixed key on the page, which every copy of the package shares', () => {
    // Two copies on one page, possibly of different versions, must agree on
    // this string, or each would print its own line.
    open();
    const issued = (globalThis as Record<string, unknown>)['__payloadLivePreviewNotices'];
    expect([...(issued as Set<string>)]).toEqual(['hook-deadline']);
    expect(said()).toHaveLength(1);
  });

  it('says nothing about a hook that names a deadline, including `timeoutMs: 0`', () => {
    open({ document: { collection: 'pages', id: '1' }, timeoutMs: 0 });
    open({ document: { global: 'header' }, timeoutMs: 5_000 });
    expect(said()).toEqual([]);
  });

  it('says nothing in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    open();
    expect(said()).toEqual([]);
  });
});

describe('an update without a locale, for a hook with one (row 31)', () => {
  const localized = { collection: 'pages', id: '1', locale: 'de' } as const;

  it.each([
    ['without being asked', {}],
    ['with `requireLocale: true`, the opt-in of 2.4', { requireLocale: true }],
  ] as const)('is left alone %s, and nothing is said', async (_label, asked) => {
    const session = open({ document: localized, timeoutMs: 0, ...asked });
    post({ data: { id: '1', title: 'No locale' } });
    await settle();
    expect(urls).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', revision: 0 });
    post({ locale: 'de', data: { id: '1', title: 'German' } });
    await settle();
    expect(session.getSnapshot().data.title).toBe('German');
    expect(said()).toEqual([]);
  });

  it('refuses another locale, and says nothing for a named one', async () => {
    open({ document: localized, timeoutMs: 0 });
    post({ locale: 'en', data: { id: '1', title: 'English' } });
    await settle();
    expect(urls).toEqual([]);
    expect(said()).toEqual([]);
  });

  it('changes nothing for a hook without a locale', async () => {
    open({ document: { collection: 'pages', id: '1' }, timeoutMs: 0 });
    post({ data: { id: '1', title: 'No locale' } });
    await settle();
    expect(urls).toHaveLength(1);
    expect(said()).toEqual([]);
  });
});

describe('a detector built without `enableReferrerDetection` (row 22)', () => {
  it('trusts no referrer, and has nothing left to announce', () => {
    const detector = new OriginDetector({
      referrer: 'https://admin.example.com/admin/collections/pages/1',
      forceDevMode: false,
    });

    expect(detector.matches(ADMIN)).toBe(false);
    expect(said()).toEqual([]);
  });
});

describe('a page with no bundler and no `process`', () => {
  it('says nothing and throws nothing, from a hook', async () => {
    // As a browser that loads the module unbundled: nothing replaced
    // `process.env.NODE_ENV`, and the global does not exist.
    const saved = globalThis.process;
    Reflect.deleteProperty(globalThis, 'process');
    try {
      expect(typeof globalThis.process).toBe('undefined');
      open({ document: { collection: 'pages', id: '1' } });
      post({ data: { id: '1', title: 'Typed' } });
    } finally {
      globalThis.process = saved;
    }
    await settle();
    expect(urls).toHaveLength(1);
    expect(said()).toEqual([]);
  });
});
