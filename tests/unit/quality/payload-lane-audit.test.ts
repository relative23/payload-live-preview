/**
 * The Payload 2 lane audits its own run directory for leaked fixture credentials and rewrites what
 * it finds. These cases pin what the audit reports and leaves alone, and that the file it read is
 * the file it rewrites: a path swapped for a link or another file in between is refused. Each case
 * runs the lane's module in its own Node process, as the lane does; links, FIFOs and modes are POSIX.
 * The lane's one Docker call is read as text, never run: the host shares its memory with every
 * other job, so the Mongo container has to carry a limit and remove itself.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const LANE = resolve(import.meta.dirname, '../../../examples/payload-version-lanes/v2');
const SETTINGS = {
  email: 'lane@example.test',
  password: 'p4ss-W0rd-xyz',
  secret: 's3cr3t-abc-123',
};
const LEAK = `signed in as ${SETTINGS.email} with ${SETTINGS.password}\n`;
// The audit never opens these: the run file, the installed app and the database files.
const PRIVATE = ['run.json', 'credential-audit.json', 'app/a.log', 'mongo-data/m.log'];

interface Outcome {
  readonly result?: {
    readonly state: string;
    readonly checkedFiles: number;
    readonly findings: readonly { readonly file: string; readonly reason: string }[];
  };
  readonly error?: { readonly code?: string; readonly message: string };
}

interface Swap {
  readonly path: string;
  readonly kind: 'link' | 'file';
  readonly to: string;
}

// The audit builds its redactor once and calls it between reading an artifact and rewriting it,
// which is the window a swap has to hit; wrapping the redactor opens that window on purpose.
const PROGRAM = `
import { renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const spec = JSON.parse(process.env.PLP_AUDIT_CASE);
if (spec.swap) {
  const diagnostics = createRequire(import.meta.url)(spec.diagnostics);
  const redactor = diagnostics.redactor;
  let swapped = false;
  diagnostics.redactor = (settings) => {
    const redact = redactor(settings);
    return (text) => {
      const sanitized = redact(text);
      if (!swapped) {
        swapped = true;
        if (spec.swap.kind === 'link') {
          unlinkSync(spec.swap.path);
          symlinkSync(spec.swap.to, spec.swap.path);
        } else renameSync(spec.swap.to, spec.swap.path);
      }
      return sanitized;
    };
  };
}
const { auditRun } = await import(pathToFileURL(spec.audit).href);
try {
  const { checkedAt, ...result } = auditRun(spec.run, spec.settings);
  console.log(JSON.stringify({ result }));
} catch (error) {
  console.log(JSON.stringify({ error: { code: error.code, message: error.message } }));
}
`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): { run: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), 'plp-lane-audit-'));
  roots.push(root);
  const run = join(root, 'run');
  const outside = join(root, 'outside');
  mkdirSync(run);
  mkdirSync(outside);
  return { run, outside };
}

function put(path: string, text: string, mode = 0o644): void {
  writeFileSync(path, text);
  chmodSync(path, mode);
}

function audit(run: string, swap?: Swap): Outcome {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', PROGRAM], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PLP_AUDIT_CASE: JSON.stringify({
        audit: join(LANE, 'audit.mjs'),
        diagnostics: join(LANE, 'template/diagnostics.cjs'),
        run,
        settings: SETTINGS,
        swap,
      }),
    },
  });
  expect(child.error).toBeUndefined();
  expect(child.stderr).toBe('');
  return JSON.parse(child.stdout) as Outcome;
}

describe('Payload 2 lane credential audit', () => {
  it('redacts a leaked credential in place and keeps the file mode', () => {
    const { run } = workspace();
    put(join(run, 'clean.log'), 'nothing to see\n');
    put(join(run, 'leak.log'), LEAK, 0o640);
    const { result } = audit(run);
    expect(result).toEqual({
      state: 'failed-private-data-redacted',
      checkedFiles: 2,
      findings: [{ file: 'leak.log', reason: 'private credential or token found and redacted' }],
    });
    const text = readFileSync(join(run, 'leak.log'), 'utf8');
    expect(text).toBe('signed in as [redacted credential] with [redacted credential]\n');
    expect(statSync(join(run, 'leak.log')).mode & 0o777).toBe(0o640);
  });

  it('passes a clean read-only artifact without opening it for writing', () => {
    const { run } = workspace();
    put(join(run, 'clean.log'), 'read-only and clean\n', 0o444);
    expect(audit(run).result).toEqual({
      state: 'clean-execution-artifacts',
      checkedFiles: 1,
      findings: [],
    });
    expect(readFileSync(join(run, 'clean.log'), 'utf8')).toBe('read-only and clean\n');
  });

  it('audits the browser artifacts and leaves the private inputs alone', () => {
    const { run } = workspace();
    mkdirSync(join(run, 'browser-artifacts/nested'), { recursive: true });
    for (const directory of ['app', 'mongo-data', 'other-dir']) mkdirSync(join(run, directory));
    put(join(run, 'browser-artifacts/nested/trace.txt'), LEAK);
    for (const name of PRIVATE) put(join(run, name), LEAK);
    put(join(run, 'other-dir/o.log'), LEAK);
    const { result } = audit(run);
    expect(result?.findings).toEqual([
      {
        file: 'browser-artifacts/nested/trace.txt',
        reason: 'private credential or token found and redacted',
      },
    ]);
    for (const name of PRIVATE) expect(readFileSync(join(run, name), 'utf8')).toBe(LEAK);
    expect(readFileSync(join(run, 'other-dir/o.log'), 'utf8')).toBe(LEAK);
  });

  it('reports a link, a FIFO and an oversized file without reading or following them', () => {
    const { run, outside } = workspace();
    put(join(outside, 'target.log'), LEAK);
    symlinkSync(join(outside, 'target.log'), join(run, 'link.log'));
    symlinkSync('does-not-exist', join(run, 'dangling.log'));
    execFileSync('mkfifo', [join(run, 'pipe')]);
    put(join(run, 'big.bin'), '');
    truncateSync(join(run, 'big.bin'), 33 * 1024 * 1024);
    const findings = [...(audit(run).result?.findings ?? [])].sort((a, b) =>
      a.file.localeCompare(b.file),
    );
    expect(findings).toEqual([
      { file: 'big.bin', reason: 'execution artifact exceeds audit bound' },
      { file: 'dangling.log', reason: 'non-regular execution artifact' },
      { file: 'link.log', reason: 'non-regular execution artifact' },
      { file: 'pipe', reason: 'non-regular execution artifact' },
    ]);
    expect(readFileSync(join(outside, 'target.log'), 'utf8')).toBe(LEAK);
  });

  it('refuses to write through a link swapped in after the read', () => {
    const { run, outside } = workspace();
    put(join(run, 'leak.log'), LEAK);
    put(join(outside, 'target.log'), 'not part of the run\n');
    const { result, error } = audit(run, {
      path: join(run, 'leak.log'),
      kind: 'link',
      to: join(outside, 'target.log'),
    });
    expect(result).toBeUndefined();
    expect(error?.code).toMatch(/^(ELOOP|EMLINK)$/u);
    expect(readFileSync(join(outside, 'target.log'), 'utf8')).toBe('not part of the run\n');
  });

  it('refuses to write into another file swapped in after the read', () => {
    const { run, outside } = workspace();
    put(join(run, 'leak.log'), LEAK);
    put(join(outside, 'other.log'), 'not part of the audit\n');
    const { result, error } = audit(run, {
      path: join(run, 'leak.log'),
      kind: 'file',
      to: join(outside, 'other.log'),
    });
    expect(result).toBeUndefined();
    expect(error?.message).toBe('Execution artifact changed during the audit: leak.log');
    expect(readFileSync(join(run, 'leak.log'), 'utf8')).toBe('not part of the audit\n');
  });
});

describe('Payload 2 lane Mongo container', () => {
  // The options of the one `docker create`: everything between the verb and the image, because an
  // option after the image would reach mongod instead of Docker.
  const options = /'create',([\s\S]*?)settings\.mongoImage/u.exec(
    readFileSync(join(LANE, 'run.mjs'), 'utf8'),
  )?.[1];

  it.each(['--memory=2g', '--memory-swap=2g', '--rm'])('is created with %s', (flag) => {
    expect(options).toBeDefined();
    expect(options).toContain(`'${flag}'`);
  });
});
