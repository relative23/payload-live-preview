import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatReport, runDoctor, type DoctorFetch } from '@doctor/index';
import { isCliInvocation, run } from '@doctor/cli';
import { ADMIN, RUNTIME } from './fixtures';

const BOUND = `${RUNTIME}<h1 data-payload-field="title">t</h1>`;
const CSP = { 'content-security-policy': `frame-ancestors 'self' ${ADMIN}` };

/** Answers each probe according to the headers it carried. */
function serverFetch(
  bodies: { publicBody: string; previewBody: string },
  headers: Record<string, string> = {},
): { fetchImpl: DoctorFetch; calls: Record<string, string>[] } {
  const calls: Record<string, string>[] = [];
  const fetchImpl: DoctorFetch = (_url, init) => {
    calls.push({ ...init.headers });
    const isPreview = init.headers['Sec-Fetch-Dest'] === 'iframe';
    return Promise.resolve({
      status: 200,
      headers: isPreview ? headers : {},
      body: isPreview ? bodies.previewBody : bodies.publicBody,
    });
  };
  return { fetchImpl, calls };
}

let out: string;
let err: string;
beforeEach(() => {
  out = '';
  err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('runDoctor probing', () => {
  it('asks for the page twice, once as a visitor and once as the admin iframe', async () => {
    const { fetchImpl, calls } = serverFetch({ publicBody: '<h1>t</h1>', previewBody: BOUND });
    await runDoctor({ url: 'https://example.com/', fetchImpl });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.['Sec-Fetch-Dest']).toBe('document');
    expect(calls[1]?.['Sec-Fetch-Dest']).toBe('iframe');
  });

  it('reaches a verdict from the two responses', async () => {
    const { fetchImpl } = serverFetch({ publicBody: '<h1>t</h1>', previewBody: BOUND }, CSP);
    const report = await runDoctor({ url: 'https://example.com/', adminOrigin: ADMIN, fetchImpl });
    expect(report.findings).toEqual([]);
    expect(report.url).toBe('https://example.com/');
  });
});

describe('formatReport', () => {
  it('says so plainly when there is nothing to report', () => {
    const text = formatReport({
      url: 'https://example.com/',
      findings: [],
      errors: 0,
      warnings: 0,
    });
    expect(text).toContain('No findings');
    expect(text).toContain('https://example.com/');
  });

  it('prints code, title, detail and remedy for each finding', () => {
    const text = formatReport({
      url: 'https://example.com/',
      findings: [
        {
          code: 'LP0703',
          level: 'error',
          title: 'blocked',
          detail: 'the detail',
          remedy: 'the remedy',
        },
      ],
      errors: 1,
      warnings: 0,
    });
    expect(text).toContain('ERROR LP0703  blocked');
    expect(text).toContain('the detail');
    expect(text).toContain('→ the remedy');
    expect(text).toContain('1 error(s), 0 warning(s).');
  });

  it('omits the arrow for an informational finding with nothing to do', () => {
    const text = formatReport({
      url: 'https://example.com/',
      findings: [{ code: 'LP0701', level: 'info', title: 'fyi', detail: 'observed', remedy: '' }],
      errors: 0,
      warnings: 0,
    });
    expect(text).not.toContain('→');
  });
});

describe('pll CLI arguments', () => {
  it('prints help and succeeds for --help, fails with no command at all', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(out).toContain('pll doctor');
    expect(await run([])).toBe(1);
  });

  it('rejects an unknown subcommand, an unknown option and a missing URL', async () => {
    expect(await run(['diagnose'])).toBe(1);
    expect(err).toContain('unknown command "diagnose"');
    expect(await run(['doctor', 'https://example.com/', '--deep'])).toBe(1);
    expect(err).toContain('--deep');
    expect(await run(['doctor'])).toBe(1);
    expect(err).toContain('a URL is required');
  });

  it('prints the doctor help for `doctor --help`', async () => {
    expect(await run(['doctor', '--help'])).toBe(0);
    expect(out).toContain('--admin');
  });

  it('rejects an --admin that is not an absolute URL before probing anything', async () => {
    const { fetchImpl, calls } = serverFetch({ publicBody: '', previewBody: '' });
    expect(
      await run(['doctor', 'https://example.com/', '--admin', 'cms.example.com'], fetchImpl),
    ).toBe(1);
    expect(err).toContain('--admin must be an absolute URL');
    expect(calls).toEqual([]);
  });
});

describe('pll doctor output', () => {
  it('prints a clean text report and exits 0 for a healthy deployment', async () => {
    const { fetchImpl } = serverFetch({ publicBody: '<h1>t</h1>', previewBody: BOUND }, CSP);
    expect(await run(['doctor', 'https://example.com/', '--admin', ADMIN], fetchImpl)).toBe(0);
    expect(out).toContain('No findings');
  });

  it('accepts --admin=<origin> as well as --admin <origin>', async () => {
    const { fetchImpl } = serverFetch(
      { publicBody: '<h1>t</h1>', previewBody: BOUND },
      { 'content-security-policy': "frame-ancestors 'self'" },
    );
    expect(await run(['doctor', 'https://example.com/', `--admin=${ADMIN}`], fetchImpl)).toBe(2);
    expect(out).toContain('LP0702');
  });

  it('emits JSON for --json and exits 2 on an error-level finding', async () => {
    const { fetchImpl } = serverFetch(
      { publicBody: '<h1>t</h1>', previewBody: BOUND },
      { 'content-security-policy': `frame-ancestors ${ADMIN}`, 'x-frame-options': 'DENY' },
    );
    expect(await run(['doctor', 'https://example.com/', '--json'], fetchImpl)).toBe(2);
    const parsed = JSON.parse(out) as { findings: { code: string }[]; errors: number };
    expect(parsed.errors).toBe(1);
    expect(parsed.findings[0]?.code).toBe('LP0703');
  });

  it('threads --v2 into the report as LP0709 readiness findings', async () => {
    const { fetchImpl } = serverFetch({ publicBody: '<h1>Title</h1>', previewBody: BOUND });
    expect(await run(['doctor', 'https://example.com/', '--v2', '--json'], fetchImpl)).toBe(0);
    expect(out).toContain('LP0709');
  });
});

describe('pll doctor failures', () => {
  it('reports an unreachable URL as a usage-level failure, not a finding', async () => {
    expect(await run(['doctor', 'http://127.0.0.1:1/'])).toBe(1);
    expect(err).toContain('could not probe');
  });

  it('names the cause of a fetch failure', async () => {
    const failing: DoctorFetch = () =>
      Promise.reject(
        new TypeError('fetch failed', { cause: new Error('self-signed certificate') }),
      );
    expect(await run(['doctor', 'https://example.com/'], failing)).toBe(1);
    expect(err).toContain('fetch failed (self-signed certificate)');
  });

  it('still emits a JSON document for --json when the probe fails', async () => {
    const failing: DoctorFetch = () =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND example.com'));
    expect(await run(['doctor', 'https://example.com/', '--json'], failing)).toBe(1);
    expect(err).toBe('');
    expect(JSON.parse(out)).toEqual({
      url: 'https://example.com/',
      error: 'getaddrinfo ENOTFOUND example.com',
    });
  });

  it('reports a usable message for a rejection that is not an Error', async () => {
    expect(
      await run(['doctor', 'https://example.com/'], () =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the case under test
        Promise.reject('socket hang up'),
      ),
    ).toBe(1);
    expect(err).toContain('socket hang up');
  });
});

describe('deciding whether this module was run or imported', () => {
  it('accepts the bin shim by basename', () => {
    expect(isCliInvocation([undefined, '/x/node_modules/.bin/pll'])).toBe(true);
    expect(isCliInvocation([undefined, 'C:\\x\\node_modules\\.bin\\pll.cmd'])).toBe(true);
    expect(isCliInvocation([undefined, '/x/dist/doctor-cli.js'])).toBe(true);
  });

  it('refuses a path that merely contains the letters, or no entry at all', () => {
    expect(isCliInvocation([undefined, '/home/dev/pll-site/scripts/build.js'])).toBe(false);
    expect(isCliInvocation([undefined, '/opt/apollo/server.js'])).toBe(false);
    expect(isCliInvocation([undefined, undefined])).toBe(false);
    expect(isCliInvocation([undefined, ''])).toBe(false);
  });
});
