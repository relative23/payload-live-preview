/**
 * npm inherits advisories through package-name edges, including cycles.
 * These measured graphs retain the actual leaf identity and reject incomplete
 * responses so an audit transport error cannot become a clean result.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  advisoryGraph,
  evaluateAuditGate,
  exposureDigest,
  findingsFromAudit,
  readAuditResponse,
  selectAuditProject,
  validateExposure,
  type AuditException,
} from '../../../scripts/audit-gate';
import { parseWorkflow } from '../../../scripts/workflow-contracts';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), `tests/fixtures/audit-no-fix/${name}.json`), 'utf8'),
  ) as unknown;
const BRACES = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const FORGE = 'https://github.com/advisories/GHSA-86w9-cpqp-85rv';

describe('audit advisory identity', () => {
  it('resolves every Changesets ancestor to the measured braces advisory', () => {
    const findings = findingsFromAudit(fixture('root'));
    expect(findings).toHaveLength(15);
    expect(findings.every((finding) => finding.id === BRACES)).toBe(true);
    expect(findings).toContainEqual({
      id: BRACES,
      package: '@changesets/cli',
      severity: 'high',
      advisoryPackage: 'braces',
    });
  });

  it('resolves the cyclic Nuxt graph without inventing advisory ids', () => {
    const findings = findingsFromAudit(fixture('nuxt-payload'));
    expect(findings).toHaveLength(11);
    expect(new Set(findings.map(({ id }) => id))).toEqual(new Set([BRACES, FORGE]));
    expect(
      findings.every(
        ({ id, advisoryPackage }) => advisoryPackage === (id === BRACES ? 'braces' : 'node-forge'),
      ),
    ).toBe(true);
  });

  it.each([null, {}, { error: { code: 'ENOAUDIT', summary: 'No audit response' } }])(
    'refuses an incomplete audit response: %j',
    (value) => {
      expect(() => findingsFromAudit(value)).toThrow();
    },
  );

  it.each([
    { pkg: { severity: 'high', via: ['missing'] } },
    { pkg: { severity: 'high', via: ['pkg'] } },
    { pkg: { severity: 'high', via: [{}] } },
    { pkg: { severity: 'unknown', via: [] } },
    { pkg: { severity: 'high', via: [{ url: BRACES, severity: 'moderate' }] } },
  ])('refuses an unresolved or inconsistent advisory graph: %j', (vulnerabilities) => {
    expect(() => findingsFromAudit({ vulnerabilities })).toThrow();
  });

  it('rejects a critical leaf hidden by a moderate aggregate', () => {
    expect(() =>
      findingsFromAudit({
        vulnerabilities: {
          pkg: { severity: 'moderate', via: [{ url: FORGE, severity: 'critical' }] },
        },
      }),
    ).toThrow('inconsistent severity');
  });

  // npm does not carry a severity around a cycle of packages: on 2026-10-22, with nuxt reaching node-forge's
  // high advisory through @nuxt/cli, @nuxt/vite-builder (via nuxt, and nuxt via it) reported moderate.
  it('accepts a lower aggregate on a cycle and reports the high leaf it reaches', () => {
    const findings = findingsFromAudit({
      vulnerabilities: {
        builder: { severity: 'moderate', via: ['framework'] },
        framework: {
          severity: 'high',
          via: ['builder', 'cli', { url: BRACES, severity: 'moderate' }],
        },
        cli: { severity: 'high', via: [{ url: FORGE, severity: 'high' }] },
      },
    });
    expect(findings).toContainEqual({
      id: FORGE,
      package: 'builder',
      advisoryPackage: 'cli',
      severity: 'high',
    });
  });

  it('still rejects a lower aggregate that no cycle explains', () => {
    expect(() =>
      findingsFromAudit({
        vulnerabilities: {
          builder: { severity: 'moderate', via: ['cli'] },
          cli: { severity: 'high', via: [{ url: FORGE, severity: 'high' }] },
        },
      }),
    ).toThrow('inconsistent severity');
  });

  it('still rejects a cycle member whose own advisory is above its aggregate', () => {
    expect(() =>
      findingsFromAudit({
        vulnerabilities: {
          builder: {
            severity: 'moderate',
            via: ['framework', { url: FORGE, severity: 'critical' }],
          },
          framework: { severity: 'critical', via: ['builder'] },
        },
      }),
    ).toThrow('inconsistent severity');
  });

  it('keeps the actual leaf severity when the aggregate mixes high and low', () => {
    expect(
      findingsFromAudit({
        vulnerabilities: {
          pkg: {
            severity: 'high',
            via: [
              { url: BRACES, severity: 'high' },
              { url: FORGE, severity: 'low' },
            ],
          },
        },
      }),
    ).toEqual([{ id: BRACES, package: 'pkg', advisoryPackage: 'pkg', severity: 'high' }]);
  });
});

const TODAY = new Date('2026-10-03T23:59:00Z');
const model = JSON.parse(
  readFileSync(resolve(process.cwd(), 'quality/audit-exceptions.json'), 'utf8'),
) as {
  schemaVersion: number;
  projects: Record<
    string,
    { exposure: string | null; exposureSha256: string | null; exceptions: AuditException[] }
  >;
};
// The last exception, node-forge in Nuxt, left the register on 2026-10-27 when the example moved to
// node-forge 1.4.1, outside the advisory's range. The recorded Nuxt audit predates that, so the register
// cases add back the entry that bound it.
const RECORDED_FORGE: AuditException = {
  id: FORGE,
  package: 'node-forge',
  version: '1.4.0',
  integrity:
    'sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==',
  graphSha256: 'c6c7ced624023c52e41e4bbdc648b79ae2807fee08c7e9f3102668346a7b593e',
  reason: 'No patched node-forge 1 release.',
  reachability: 'Development commands keep HTTPS and PFX disabled.',
  expires: '2026-11-21',
};
const withRecordedForge = (): typeof model => {
  const value = structuredClone(model);
  value.projects['examples/nuxt-payload']?.exceptions.push(structuredClone(RECORDED_FORGE));
  return value;
};
describe('scoped audit register', () => {
  it('retains a reviewed clean-project descriptor without creating an exception', () => {
    const value = structuredClone(model);
    const project = value.projects['examples/astro-payload'];
    expect(project).toBeDefined();
    if (project) project.exceptions = [];
    const selected = selectAuditProject(value, process.cwd(), 'examples/astro-payload', TODAY);
    expect(selected.project.exposure).toBe('quality/audit-exposure/astro-payload.json');
    expect(selected.project.exceptions).toEqual([]);
  });

  it.each([
    { exposure: null, exposureSha256: 'a'.repeat(64) },
    { exposure: 'quality/audit-exposure/astro-payload.json', exposureSha256: null },
    { exposure: '', exposureSha256: 'a'.repeat(64) },
    { exposure: 'quality/audit-exposure/astro-payload.json', exposureSha256: 'invalid' },
  ])('rejects an incomplete clean exposure binding: %j', (binding) => {
    const value = structuredClone(model);
    Object.assign(value.projects['examples/astro-payload'] ?? {}, binding, { exceptions: [] });
    expect(() => selectAuditProject(value, process.cwd(), 'examples/astro-payload', TODAY)).toThrow(
      'exposure binding',
    );
  });

  // The braces advisory was withdrawn on 2026-10-23 and its exceptions left the register. The recorded
  // audits predate that, so the gate is evaluated on the bound advisory's findings alone.
  it.each([
    { project: 'examples/nuxt-payload', name: 'nuxt-payload', leaf: 'node-forge', id: FORGE },
  ])('binds the measured $project/$leaf graph', ({ project, leaf, id, name }) => {
    const register = withRecordedForge();
    const entry = register.projects[project]?.exceptions.find(
      (value) => value.package === leaf && value.id === id,
    );
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error(`missing reviewed graph ${project}/${leaf}`);
    const audit = fixture(name);
    const findings = findingsFromAudit(audit);
    const lock = fixture(`${name}.lock`);
    const graph = advisoryGraph(audit, lock, findings, entry.package, entry.id);
    expect(graph).toEqual({
      sha256: entry.graphSha256,
      version: entry.version,
      integrity: entry.integrity,
    });
    const selected = selectAuditProject(register, process.cwd(), project, TODAY);
    expect(
      evaluateAuditGate(
        findings.filter((finding) => finding.id === id),
        { schemaVersion: 2, exceptions: selected.project.exceptions },
        TODAY,
      ).ok,
    ).toBe(true);
  });

  it.each(['astro-payload', 'astro-hybrid', 'astro-inline', 'astro-middleware'])(
    'keeps the known cache path source- and caller-bound after audit removal: %s',
    (name) => {
      const project = `examples/${name}`;
      const selected = selectAuditProject(model, process.cwd(), project, TODAY);
      expect(selected.project.exceptions).toEqual([]);
      expect(selected.project.exposure).not.toBeNull();
      const descriptor = JSON.parse(
        readFileSync(resolve(process.cwd(), selected.project.exposure ?? ''), 'utf8'),
      ) as { callers: Record<string, readonly string[]> };
      expect(exposureDigest(descriptor)).toBe(selected.project.exposureSha256);
      expect(descriptor.callers['node_modules/http-cache-semantics']).toEqual([
        '4.3.0',
        'sha512-M5t5LlJpS1UHMjvwRQVdFHvPISGeLAxNcrWuJkeGh0KxsqCHZ1O3NXZU/8x7cD0BDcGW8kapxMKTvwlqrNkHkA==',
      ]);
      expect(descriptor.callers['node_modules/astro']).toHaveLength(2);
      const lock: unknown = JSON.parse(
        readFileSync(resolve(process.cwd(), project, 'package-lock.json'), 'utf8'),
      );
      expect(() => validateExposure(descriptor, process.cwd(), lock)).not.toThrow();
    },
  );

  it('isolates clean projects and still rejects every selected unused exception', () => {
    const selected = selectAuditProject(model, process.cwd(), 'examples/pure-html', TODAY);
    expect(selected.project.exceptions).toEqual([]);
    expect(
      evaluateAuditGate([], { schemaVersion: 2, exceptions: selected.project.exceptions }, TODAY)
        .ok,
    ).toBe(true);
    const nuxt = selectAuditProject(
      withRecordedForge(),
      process.cwd(),
      'examples/nuxt-payload',
      TODAY,
    );
    expect(
      evaluateAuditGate([], { schemaVersion: 2, exceptions: nuxt.project.exceptions }, TODAY).ok,
    ).toBe(false);
  });

  it.each(['../outside', '/outside', 'examples/unknown'])(
    'rejects unknown or outside project %s',
    (prefix) => {
      expect(() => selectAuditProject(model, process.cwd(), prefix, TODAY)).toThrow();
    },
  );

  it('accepts the last UTC day and rejects expiry even in an inactive project', () => {
    const register = withRecordedForge();
    const [lastDay] = Object.values(register.projects)
      .flatMap((project) => project.exceptions.map((exception) => exception.expires))
      .sort();
    expect(lastDay).toBeDefined();
    const nextDay = new Date(Date.parse(`${lastDay}T00:00:00Z`) + 86_400_000);
    expect(() =>
      selectAuditProject(
        register,
        process.cwd(),
        'examples/pure-html',
        new Date(`${lastDay}T23:59:59Z`),
      ),
    ).not.toThrow();
    expect(() =>
      selectAuditProject(register, process.cwd(), 'examples/pure-html', nextDay),
    ).toThrow('expired');
  });

  it.each(['2026-02-30', '2026-13-01', '2028-02-30', '2026-10-1', '2026-10-10T00:00:00Z'])(
    'rejects a non-calendar ISO expiry %s even in an inactive project',
    (expires) => {
      const value = withRecordedForge();
      const entry = value.projects['examples/nuxt-payload']?.exceptions[0];
      expect(entry).toBeDefined();
      Object.assign(entry ?? {}, { expires });
      expect(() => selectAuditProject(value, process.cwd(), 'examples/pure-html', TODAY)).toThrow();
    },
  );

  it.each(['id', 'version', 'integrity', 'graphSha256', 'reason', 'reachability', 'expires'])(
    'rejects malformed inactive %s',
    (field) => {
      const value = withRecordedForge();
      const entry = value.projects['examples/nuxt-payload']?.exceptions[0];
      expect(entry).toBeDefined();
      Object.assign(entry ?? {}, { [field]: '' });
      expect(() => selectAuditProject(value, process.cwd(), 'examples/pure-html', TODAY)).toThrow();
    },
  );

  it('rejects duplicate declarations and a missing descriptor binding', () => {
    const value = withRecordedForge();
    const nuxt = value.projects['examples/nuxt-payload'];
    expect(nuxt).toBeDefined();
    nuxt?.exceptions.push({ ...nuxt.exceptions[0]! });
    expect(() => selectAuditProject(value, process.cwd(), 'examples/pure-html', TODAY)).toThrow(
      'duplicate',
    );
    const unbound = structuredClone(model);
    const bound = unbound.projects['examples/nuxt-payload'];
    if (bound) bound.exposureSha256 = null;
    expect(() => selectAuditProject(unbound, process.cwd(), 'examples/pure-html', TODAY)).toThrow(
      'exposure',
    );
  });

  it('fails a new GHSA instead of covering it by leaf package name', () => {
    const findings = findingsFromAudit(fixture('nuxt-payload')).filter(({ id }) => id === FORGE);
    const selected = selectAuditProject(
      withRecordedForge(),
      process.cwd(),
      'examples/nuxt-payload',
      TODAY,
    );
    const register = { schemaVersion: 2, exceptions: selected.project.exceptions };
    expect(evaluateAuditGate(findings, register, TODAY).ok).toBe(true);
    const changed = findings.map((finding) => ({ ...finding, id: BRACES }));
    expect(evaluateAuditGate(changed, register, TODAY).ok).toBe(false);
  });

  it('binds caller versions, integrities, paths and parent fix suggestions', () => {
    const audit = fixture('root') as { vulnerabilities: Record<string, { fixAvailable: unknown }> };
    const lock = fixture('root.lock') as { packages: Record<string, Record<string, unknown>> };
    const findings = findingsFromAudit(audit);
    const before = advisoryGraph(audit, lock, findings, 'braces', BRACES).sha256;
    for (const field of ['version', 'integrity', 'dependencies']) {
      const changed = structuredClone(lock);
      Object.assign(changed.packages['node_modules/micromatch'] ?? {}, { [field]: 'changed' });
      expect(advisoryGraph(audit, changed, findings, 'braces', BRACES).sha256).not.toBe(before);
    }
    const changed = structuredClone(audit);
    const cli = changed.vulnerabilities['@changesets/cli'];
    if (cli) {
      cli.fixAvailable = { name: '@changesets/cli', version: '2.99.0', isSemVerMajor: false };
    }
    expect(advisoryGraph(changed, lock, findings, 'braces', BRACES).sha256).not.toBe(before);
    const absent = structuredClone(lock);
    delete absent.packages['node_modules/braces'];
    expect(() => advisoryGraph(audit, absent, findings, 'braces', BRACES)).toThrow('locked node');
  });

  it('ignores only product version metadata, keeping its source and peer contract', () => {
    const audit = fixture('astro-payload');
    const lock = fixture('astro-payload.lock') as {
      packages: Record<string, Record<string, unknown>>;
    };
    const findings = findingsFromAudit(audit);
    const id = 'https://github.com/advisories/GHSA-ch52-4w7c-c8xp';
    const before = advisoryGraph(audit, lock, findings, 'http-cache-semantics', id).sha256;
    const product = lock.packages['node_modules/payload-live-preview'];
    expect(product).toBeDefined();
    if (product) product['version'] = '2.0.6';
    expect(advisoryGraph(audit, lock, findings, 'http-cache-semantics', id).sha256).toBe(before);
    if (product) product['peerDependencies'] = {};
    expect(advisoryGraph(audit, lock, findings, 'http-cache-semantics', id).sha256).not.toBe(
      before,
    );
  });

  it('keeps all ten fixture audits and the Root audit in CI', () => {
    const workflow = parseWorkflow(
      readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8'),
    );
    const jobs = workflow['jobs'] as Record<string, { steps: { run?: string }[] }>;
    const fixtureCommands =
      jobs['fixture-audit']?.steps
        .flatMap(({ run }) => (run === undefined ? [] : [run]))
        .filter((run) => run.startsWith('node scripts/audit-gate.ts')) ?? [];
    expect(fixtureCommands).toHaveLength(10);
    expect(new Set(fixtureCommands.map((command) => command.split('--prefix ')[1]))).toEqual(
      new Set(Object.keys(model.projects).filter((project) => project !== '.')),
    );
    expect(fixtureCommands.every((command) => command.includes('--package-lock-only'))).toBe(true);
    expect(jobs['lint']?.steps.some(({ run }) => run === 'npm run audit:gate')).toBe(true);
  });
});

describe('audit response failures', () => {
  const clean = JSON.stringify({
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  });
  it.each([
    { status: 2, stdout: clean },
    { status: null, stdout: clean },
    { status: 0, signal: 'SIGTERM', stdout: clean },
    { status: 0, error: new Error('network'), stdout: clean },
    { status: 0, stdout: '{}' },
    { status: 0, stdout: 'not JSON' },
    { status: 1, stdout: '{"error":{"code":"EAI_AGAIN"}}' },
    { status: 0, stdout: clean.replace('"total":0', '"total":1') },
  ])('does not accept a failed or inconsistent response: %j', (value) => {
    expect(() => readAuditResponse(value)).toThrow();
  });
  it('accepts complete clean JSON and advisory exit1', () => {
    expect(findingsFromAudit(readAuditResponse({ status: 0, stdout: clean }))).toEqual([]);
    expect(
      findingsFromAudit(readAuditResponse({ status: 1, stdout: JSON.stringify(fixture('root')) })),
    ).toHaveLength(15);
  });
});

describe('exposure changes', () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'plp-audit-exposure-'));
    temporary.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/app.ts'), 'export const http = true;\n');
    writeFileSync(join(root, 'package.json'), '{"version":"2.0.5","scripts":{"dev":"http"}}');
    writeFileSync(join(root, 'config.json'), '{"baseBranch":"main","fixed":[]}');
    const integrity = 'sha512-' + Buffer.alloc(64, 1).toString('base64');
    const lock = { packages: { 'node_modules/caller': { version: '1.0.0', integrity } } };
    const descriptor = {
      sources: {
        'src/app.ts': createHash('sha256')
          .update(readFileSync(join(root, 'src/app.ts')))
          .digest('hex'),
      },
      directories: ['src'],
      absentFiles: ['pnpm-workspace.yaml'],
      json: [
        { path: 'package.json', values: { scripts: { dev: 'http' } }, absent: ['workspaces'] },
        { path: 'config.json', values: { fixed: [] }, absent: [] },
      ],
      callers: { 'node_modules/caller': ['1.0.0', integrity] },
    };
    return { root, lock, descriptor };
  };
  it('rejects a fully empty reachability descriptor', () => {
    expect(() =>
      validateExposure(
        { sources: {}, directories: [], absentFiles: [], json: [], callers: {} },
        process.cwd(),
        { packages: {} },
      ),
    ).toThrow('exposure');
  });
  it.each(['sources', 'callers', 'json', 'projection'])(
    'requires actual exposure pins in %s',
    (field) => {
      const { root, lock, descriptor } = setup();
      const value: Record<string, unknown> = structuredClone(descriptor);
      if (field === 'sources') {
        value['sources'] = {};
        value['directories'] = [];
      }
      if (field === 'callers') value['callers'] = {};
      if (field === 'json') value['json'] = [];
      if (field === 'projection') {
        value['json'] = [{ path: 'package.json', values: {}, absent: [] }];
      }
      expect(() => validateExposure(value, root, lock)).toThrow('exposure');
    },
  );
  it('retains valid binding after package version and baseBranch changes', () => {
    const { root, lock, descriptor } = setup();
    validateExposure(descriptor, root, lock);
    writeFileSync(join(root, 'package.json'), '{"version":"2.1.0","scripts":{"dev":"http"}}');
    writeFileSync(join(root, 'config.json'), '{"baseBranch":"release/2.0","fixed":[]}');
    expect(() => validateExposure(descriptor, root, lock)).not.toThrow();
  });
  it.each([
    'md',
    'markdown',
    'mdown',
    'mkdn',
    'mkd',
    'mdwn',
    'mdx',
    'jsx',
    'mts',
    'cts',
    'svelte',
    'html',
    'css',
  ])('rejects a newly discovered source format .%s', (extension) => {
    const { root, lock, descriptor } = setup();
    writeFileSync(join(root, `src/new.${extension}`), 'New source or content entry\n');
    expect(() => validateExposure(descriptor, root, lock)).toThrow('source exposure set changed');
  });
  it('excludes generated folders consistently at deeper source levels', () => {
    const { root, lock, descriptor } = setup();
    for (const name of [
      'node_modules',
      'dist',
      '.astro',
      '.nuxt',
      '.output',
      '.vercel',
      '.netlify',
    ]) {
      const generated = join(root, 'src/components', name);
      mkdirSync(generated, { recursive: true });
      writeFileSync(join(generated, 'generated.ts'), 'export const generated = true;\n');
    }
    expect(() => validateExposure(descriptor, root, lock)).not.toThrow();
  });
  it.each(['source', 'added-source', 'scripts', 'workspace', 'caller', 'absent-file'])(
    'rejects security exposure drift: %s',
    (change) => {
      const { root, lock, descriptor } = setup();
      if (change === 'source') {
        writeFileSync(join(root, 'src/app.ts'), 'export const https = true;\n');
      }
      if (change === 'added-source') writeFileSync(join(root, 'src/new.vue'), '<template/>');
      if (change === 'scripts') {
        writeFileSync(join(root, 'package.json'), '{"scripts":{"dev":"https"}}');
      }
      if (change === 'workspace') {
        writeFileSync(join(root, 'package.json'), '{"scripts":{"dev":"http"},"workspaces":["*"]}');
      }
      if (change === 'caller') lock.packages['node_modules/caller'].version = '1.0.1';
      if (change === 'absent-file') {
        writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: ["*"]');
      }
      expect(() => validateExposure(descriptor, root, lock)).toThrow();
    },
  );
  it('detects removing descriptor pins and rejects source symlinks', () => {
    const { root, lock, descriptor } = setup();
    const before = exposureDigest(descriptor);
    const reduced = structuredClone(descriptor);
    reduced.callers = {} as typeof descriptor.callers;
    expect(exposureDigest(reduced)).not.toBe(before);
    symlinkSync(join(root, 'config.json'), join(root, 'src/linked.json'));
    expect(() => validateExposure(descriptor, root, lock)).toThrow('symlink');
  });
});
