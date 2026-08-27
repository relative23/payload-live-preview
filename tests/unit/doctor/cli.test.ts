import { describe, expect, it, vi } from 'vitest';
import { formatReport, runDoctor, type DoctorFetch } from '@doctor/index';
import { isCliInvocation, run } from '@doctor/cli';

const RUNTIME = '<script>var __LIVE_PREVIEW_CONFIG__=[["https://cms.example.com"]];</script>';
const ADMIN = 'https://cms.example.com';

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

describe('runDoctor probing', () => {
  it('asks for the page twice, once as a visitor and once as the admin iframe', async () => {
    const { fetchImpl, calls } = serverFetch({
      publicBody: '<h1>t</h1>',
      previewBody: `${RUNTIME}<h1 data-payload-field="title">t</h1>`,
    });
    await runDoctor({ url: 'https://example.com/', fetchImpl });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.['Sec-Fetch-Dest']).toBe('document');
    expect(calls[1]?.['Sec-Fetch-Dest']).toBe('iframe');
  });

  it('sends no referer on the visitor probe, because that is itself a preview signal', async () => {
    const { fetchImpl, calls } = serverFetch({
      publicBody: '<h1>t</h1>',
      previewBody: `${RUNTIME}<h1 data-payload-field="title">t</h1>`,
    });
    await runDoctor({ url: 'https://example.com/', adminOrigin: ADMIN, fetchImpl });

    expect(calls[0]?.['Referer']).toBeUndefined();
    expect(calls[1]?.['Referer']).toBe(`${ADMIN}/`);
  });

  it('reaches a verdict from the two responses', async () => {
    const { fetchImpl } = serverFetch(
      {
        publicBody: '<h1>t</h1>',
        previewBody: `${RUNTIME}<h1 data-payload-field="title">t</h1>`,
      },
      { 'content-security-policy': `frame-ancestors 'self' ${ADMIN}` },
    );
    const report = await runDoctor({
      url: 'https://example.com/',
      adminOrigin: ADMIN,
      fetchImpl,
    });
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

describe('pll CLI', () => {
  function captureStdout(): { text: () => string; restore: () => void } {
    let buffer = '';
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        buffer += String(chunk);
        return true;
      });
    return {
      text: () => buffer,
      restore: () => {
        spy.mockRestore();
      },
    };
  }

  function captureStderr(): { text: () => string; restore: () => void } {
    let buffer = '';
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        buffer += String(chunk);
        return true;
      });
    return {
      text: () => buffer,
      restore: () => {
        spy.mockRestore();
      },
    };
  }

  it('prints help and succeeds for --help', async () => {
    const out = captureStdout();
    const code = await run(['--help']);
    out.restore();
    expect(code).toBe(0);
    expect(out.text()).toContain('pll doctor');
  });

  it('prints help and fails when invoked with no command at all', async () => {
    const out = captureStdout();
    const code = await run([]);
    out.restore();
    // Usage error rather than success: the caller asked for nothing.
    expect(code).toBe(1);
  });

  it('rejects an unknown subcommand', async () => {
    const err = captureStderr();
    const code = await run(['diagnose']);
    err.restore();
    expect(code).toBe(1);
    expect(err.text()).toContain('unknown command "diagnose"');
  });

  it('rejects an unknown option instead of ignoring it', async () => {
    const err = captureStderr();
    const code = await run(['doctor', 'https://example.com/', '--deep']);
    err.restore();
    expect(code).toBe(1);
    expect(err.text()).toContain('--deep');
  });

  it('requires a URL', async () => {
    const err = captureStderr();
    const code = await run(['doctor']);
    err.restore();
    expect(code).toBe(1);
    expect(err.text()).toContain('a URL is required');
  });

  it('prints the doctor help for `doctor --help`', async () => {
    const out = captureStdout();
    const code = await run(['doctor', '--help']);
    out.restore();
    expect(code).toBe(0);
    expect(out.text()).toContain('--admin');
  });

  it('prints a clean text report and exits 0 for a healthy deployment', async () => {
    const { fetchImpl } = serverFetch(
      {
        publicBody: '<h1>t</h1>',
        previewBody: `${RUNTIME}<h1 data-payload-field="title">t</h1>`,
      },
      { 'content-security-policy': `frame-ancestors 'self' ${ADMIN}` },
    );
    const out = captureStdout();
    const code = await run(['doctor', 'https://example.com/', '--admin', ADMIN], fetchImpl);
    out.restore();
    expect(code).toBe(0);
    expect(out.text()).toContain('No findings');
  });

  it('accepts --admin=<origin> as well as --admin <origin>', async () => {
    const { fetchImpl } = serverFetch(
      {
        publicBody: '<h1>t</h1>',
        previewBody: `${RUNTIME}<h1 data-payload-field="title">t</h1>`,
      },
      { 'content-security-policy': "frame-ancestors 'self'" },
    );
    const out = captureStdout();
    const code = await run(['doctor', 'https://example.com/', `--admin=${ADMIN}`], fetchImpl);
    out.restore();
    // The policy excludes the admin origin, which is an error — proving the
    // joined form reached the check rather than being dropped.
    expect(code).toBe(2);
    expect(out.text()).toContain('LP0702');
  });

  it('emits JSON for --json and exits 2 on an error-level finding', async () => {
    // X-Frame-Options: DENY is unconditionally fatal, unlike a missing inline
    // runtime, which a consumer starting the client themselves would produce.
    const { fetchImpl } = serverFetch(
      {
        publicBody: '<h1>t</h1>',
        previewBody: `${RUNTIME}<h1 data-payload-field="title">t</h1>`,
      },
      { 'content-security-policy': `frame-ancestors ${ADMIN}`, 'x-frame-options': 'DENY' },
    );
    const out = captureStdout();
    const code = await run(['doctor', 'https://example.com/', '--json'], fetchImpl);
    out.restore();
    expect(code).toBe(2);
    const parsed = JSON.parse(out.text()) as { findings: { code: string }[]; errors: number };
    expect(parsed.errors).toBe(1);
    expect(parsed.findings[0]?.code).toBe('LP0703');
  });

  it('reports an unreachable URL as a usage-level failure, not a finding', async () => {
    const err = captureStderr();
    const code = await run(['doctor', 'http://127.0.0.1:1/']);
    err.restore();
    expect(code).toBe(1);
    expect(err.text()).toContain('could not probe');
  });
});

describe('deciding whether this module was run or imported', () => {
  // The first version matched `includes('pll')` against the whole path, which
  // would auto-run the CLI on import for any project living in a directory
  // whose name happens to contain those three letters.
  it('accepts the bin shim by basename', () => {
    expect(isCliInvocation([undefined, '/x/node_modules/.bin/pll'])).toBe(true);
    expect(isCliInvocation([undefined, 'C:\\x\\node_modules\\.bin\\pll.cmd'])).toBe(true);
    expect(isCliInvocation([undefined, '/x/dist/doctor-cli.js'])).toBe(true);
  });

  it('refuses a path that merely contains the letters', () => {
    expect(isCliInvocation([undefined, '/home/dev/pll-site/scripts/build.js'])).toBe(false);
    expect(isCliInvocation([undefined, '/opt/apollo/server.js'])).toBe(false);
  });

  it('refuses a missing or empty entry', () => {
    expect(isCliInvocation([undefined, undefined])).toBe(false);
    expect(isCliInvocation([undefined, ''])).toBe(false);
  });
});

describe('failures that are not Error instances', () => {
  it('still reports a usable message instead of [object Object]', async () => {
    const err = captureStderrOutside();
    const code = await run(['doctor', 'https://example.com/'], () => {
      // A fetch implementation is consumer-supplied in principle; nothing
      // guarantees it rejects with an Error.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberate
      return Promise.reject('socket hang up');
    });
    err.restore();
    expect(code).toBe(1);
    expect(err.text()).toContain('socket hang up');
  });
});

function captureStderrOutside(): { text: () => string; restore: () => void } {
  let buffer = '';
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    buffer += String(chunk);
    return true;
  });
  return {
    text: () => buffer,
    restore: () => {
      spy.mockRestore();
    },
  };
}

describe('pll doctor --v2', () => {
  it('threads the --v2 flag into the report as LP0709 readiness findings', async () => {
    const { fetchImpl } = serverFetch({
      publicBody: '<h1>Title</h1>',
      previewBody: `${RUNTIME}<h1 data-payload-field="title">Title</h1>`,
    });
    const out: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    const code = await run(['doctor', 'https://example.com/', '--v2', '--json'], fetchImpl);
    write.mockRestore();
    expect(code).toBe(0);
    expect(out.join('')).toContain('LP0709');
  });
});
