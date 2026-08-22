import { describe, expect, it, vi } from 'vitest';
import { lowercaseHeaders, runDoctor } from '@doctor/probe';
import { DEFAULT_VISIBILITY_THRESHOLD } from '@core/update-scheduler';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('header normalisation', () => {
  // Every header check downstream reads a lowercase key. If this were wrong,
  // content-security-policy and x-frame-options would both read as absent and
  // the audit would invent findings instead of reporting them — the same shape
  // of silent wrongness the same-origin bug had.
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

describe('the default fetch path', () => {
  // runDoctor falls back to globalThis.fetch when no implementation is
  // injected. Every test elsewhere injects one, which left the code that
  // actually talks to a server unmeasured.
  it('uses globalThis.fetch, follows redirects, and reads status/headers/body', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        // RequestInfo covers Request too, which has no useful toString().
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        seen.push({ url, init: init ?? {} });
        return Promise.resolve(
          new Response('<h1 data-payload-field="title">t</h1>', {
            status: 200,
            headers: { 'Content-Security-Policy': "frame-ancestors 'self'" },
          }),
        );
      });

    const report = await runDoctor({
      url: 'https://example.com/',
      adminOrigin: 'https://example.com',
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]?.init.redirect).toBe('follow');
    // Headers arrived lowercased, so the frame-ancestors check saw the policy
    // and — same origin — accepted the bare 'self'.
    expect(report.findings.map((f) => f.code)).not.toContain('LP0702');
    fetchSpy.mockRestore();
  });

  it('lets a network failure escape so the CLI can report it as a usage error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(runDoctor({ url: 'https://nope.invalid/' })).rejects.toThrow('ENOTFOUND');
    fetchSpy.mockRestore();
  });
});

describe('the visibility-gate threshold is duplicated on purpose', () => {
  // The audit runs outside the runtime bundle and must not import the
  // scheduler, so it restates the default. Nothing bound the two together,
  // which means changing the scheduler's default would have left the audit
  // silently reporting against the old number.
  it('matches the scheduler default it mirrors', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/doctor/analyze.ts'), 'utf8');
    const declared = /const DEFAULT_VISIBILITY_GATE_THRESHOLD = (\d+);/u.exec(source)?.[1];
    expect(declared).toBeDefined();
    expect(Number(declared)).toBe(DEFAULT_VISIBILITY_THRESHOLD);
  });
});
