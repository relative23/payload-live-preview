import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VISIBILITY_THRESHOLD } from '@core/update-scheduler';
import {
  createDefaultFetch,
  describeFailure,
  lowercaseHeaders,
  previewReferer,
  runDoctor,
  type DoctorFetch,
} from '@doctor/probe';

const PAGE = '<h1 data-payload-field="title">t</h1>';
const INIT = { headers: { Accept: 'text/html' } };

describe('header normalisation', () => {
  it('lowercases names and keeps values untouched', () => {
    const headers = new Headers();
    headers.set('Content-Security-Policy', "frame-ancestors 'self'");
    headers.set('X-Frame-Options', 'DENY');
    expect(lowercaseHeaders(headers)).toEqual({
      'content-security-policy': "frame-ancestors 'self'",
      'x-frame-options': 'DENY',
    });
  });

  it('returns an empty record for a response with no headers', () => {
    expect(lowercaseHeaders(new Headers())).toEqual({});
  });
});

describe('the default fetch', () => {
  it('uses globalThis.fetch with a timeout and without following redirects', async () => {
    const seen: RequestInit[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      seen.push(init ?? {});
      return Promise.resolve(
        new Response(PAGE, {
          status: 200,
          headers: { 'Content-Security-Policy': "frame-ancestors 'self'" },
        }),
      );
    });
    const report = await runDoctor({
      url: 'https://example.com/',
      adminOrigin: 'https://example.com',
    });
    fetchSpy.mockRestore();
    expect(seen).toHaveLength(2);
    expect(seen[0]?.redirect).toBe('manual');
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(report.findings.map((f) => f.code)).not.toContain('LP0702');
  });

  it('hands a redirect to the analysis as the response it is', async () => {
    const fetchFn: typeof fetch = () =>
      Promise.resolve(
        new Response('', { status: 302, headers: { Location: 'https://example.com/login' } }),
      );
    const response = await createDefaultFetch({ fetchFn })('https://example.com/', INIT);
    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('https://example.com/login');
    const report = await runDoctor({
      url: 'https://example.com/',
      fetchImpl: createDefaultFetch({ fetchFn }),
    });
    expect(report.findings[0]?.title).toContain('redirected (302) to https://example.com/login');
  });

  it('abandons an origin that never answers', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    await expect(
      createDefaultFetch({ fetchFn: hang, timeoutMs: 20 })('https://example.com/', INIT),
    ).rejects.toThrow('no response within 0.02 s');
  });

  it('refuses a body beyond the cap rather than judging half a page', async () => {
    const fetchFn: typeof fetch = () => Promise.resolve(new Response('x'.repeat(4096)));
    await expect(
      createDefaultFetch({ fetchFn, maxBodyBytes: 1024 })('https://example.com/', INIT),
    ).rejects.toThrow('exceeds 1024 bytes');
    const within = await createDefaultFetch({ fetchFn, maxBodyBytes: 4096 })(
      'https://example.com/',
      INIT,
    );
    expect(within.body).toHaveLength(4096);
  });

  it('lets a network failure escape so the CLI can report it', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(runDoctor({ url: 'https://nope.invalid/' })).rejects.toThrow('ENOTFOUND');
    fetchSpy.mockRestore();
  });
});

describe('describeFailure', () => {
  it('surfaces the cause undici hides behind "fetch failed"', () => {
    const error = new TypeError('fetch failed', { cause: new Error('self-signed certificate') });
    expect(describeFailure(error)).toBe('fetch failed (self-signed certificate)');
    expect(describeFailure(new Error('plain'))).toBe('plain');
    expect(describeFailure('socket hang up')).toBe('socket hang up');
  });
});

describe('the preview probe', () => {
  function recording(): { fetchImpl: DoctorFetch; calls: Record<string, string>[] } {
    const calls: Record<string, string>[] = [];
    return {
      calls,
      fetchImpl: (_url, init) => {
        calls.push({ ...init.headers });
        return Promise.resolve({ status: 200, headers: {}, body: PAGE });
      },
    };
  }

  it('sends no referer on the visitor probe and exactly one slash on the admin one', async () => {
    const { fetchImpl, calls } = recording();
    await runDoctor({
      url: 'https://example.com/',
      adminOrigin: 'https://cms.example.com/',
      fetchImpl,
    });
    expect(calls[0]?.['Referer']).toBeUndefined();
    expect(calls[1]?.['Referer']).toBe('https://cms.example.com/');
  });

  it.each([
    ['https://cms.example.com', 'https://cms.example.com/'],
    ['https://cms.example.com/', 'https://cms.example.com/'],
    ['https://cms.example.com/admin', 'https://cms.example.com/admin'],
    ['not a url/', 'not a url/'],
  ])('normalises %s to the referer %s', (adminOrigin, referer) => {
    expect(previewReferer(adminOrigin)).toBe(referer);
  });
});

describe('the visibility-gate threshold is duplicated on purpose', () => {
  it('matches the scheduler default it mirrors', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/doctor/analyze.ts'), 'utf8');
    const declared = /const DEFAULT_VISIBILITY_GATE_THRESHOLD = (\d+);/u.exec(source)?.[1];
    expect(declared).toBeDefined();
    expect(Number(declared)).toBe(DEFAULT_VISIBILITY_THRESHOLD);
  });
});
