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
const CACHE = 'https://github.com/advisories/GHSA-ch52-4w7c-c8xp';

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
describe('scoped audit register', () => {
  it.each([
    { project: '.', name: 'root', leaf: 'braces', id: BRACES },
    { project: 'examples/nuxt-payload', name: 'nuxt-payload', leaf: 'braces', id: BRACES },
    { project: 'examples/nuxt-payload', name: 'nuxt-payload', leaf: 'node-forge', id: FORGE },
    {
      project: 'examples/astro-payload',
      name: 'astro-payload',
      leaf: 'http-cache-semantics',
      id: CACHE,
    },
    {
      project: 'examples/astro-hybrid',
      name: 'astro-hybrid',
      leaf: 'http-cache-semantics',
      id: CACHE,
    },
    {
      project: 'examples/astro-inline',
      name: 'astro-inline',
      leaf: 'http-cache-semantics',
      id: CACHE,
    },
    {
      project: 'examples/astro-middleware',
      name: 'astro-middleware',
      leaf: 'http-cache-semantics',
      id: CACHE,
    },
  ])('binds the measured $project/$leaf graph', ({ project, leaf, id, name }) => {
    const entry = model.projects[project]?.exceptions.find(
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
    const selected = selectAuditProject(model, process.cwd(), project, TODAY);
    expect(
      evaluateAuditGate(
        findings,
        { schemaVersion: 2, exceptions: selected.project.exceptions },
        TODAY,
      ).ok,
    ).toBe(true);
  });

  it('isolates clean projects and still rejects every selected unused exception', () => {
    const selected = selectAuditProject(model, process.cwd(), 'examples/pure-html', TODAY);
    expect(selected.project.exceptions).toEqual([]);
    expect(
      evaluateAuditGate([], { schemaVersion: 2, exceptions: selected.project.exceptions }, TODAY)
        .ok,
    ).toBe(true);
    const root = selectAuditProject(model, process.cwd(), '.', TODAY);
    expect(
      evaluateAuditGate([], { schemaVersion: 2, exceptions: root.project.exceptions }, TODAY).ok,
    ).toBe(false);
  });

  it.each(['../outside', '/outside', 'examples/unknown'])(
    'rejects unknown or outside project %s',
    (prefix) => {
      expect(() => selectAuditProject(model, process.cwd(), prefix, TODAY)).toThrow();
    },
  );

  it('accepts the last UTC day and rejects expiry even in an inactive project', () => {
    expect(() =>
      selectAuditProject(
        model,
        process.cwd(),
        'examples/pure-html',
        new Date('2026-10-10T23:59:59Z'),
      ),
    ).not.toThrow();
    expect(() =>
      selectAuditProject(
        model,
        process.cwd(),
        'examples/pure-html',
        new Date('2026-10-11T00:00:00Z'),
      ),
    ).toThrow('expired');
  });

  it.each(['2026-02-30', '2026-13-01', '2028-02-30', '2026-10-1', '2026-10-10T00:00:00Z'])(
    'rejects a non-calendar ISO expiry %s even in an inactive project',
    (expires) => {
      const value = structuredClone(model);
      const entry = value.projects['.']?.exceptions[0];
      expect(entry).toBeDefined();
      Object.assign(entry ?? {}, { expires });
      expect(() => selectAuditProject(value, process.cwd(), 'examples/pure-html', TODAY)).toThrow();
    },
  );

  it.each(['id', 'version', 'integrity', 'graphSha256', 'reason', 'reachability', 'expires'])(
    'rejects malformed inactive %s',
    (field) => {
      const value = structuredClone(model);
      const entry = value.projects['.']?.exceptions[0];
      expect(entry).toBeDefined();
      Object.assign(entry ?? {}, { [field]: '' });
      expect(() => selectAuditProject(value, process.cwd(), 'examples/pure-html', TODAY)).toThrow();
    },
  );

  it('rejects duplicate declarations and a missing descriptor binding', () => {
    const value = structuredClone(model);
    const root = value.projects['.'];
    expect(root).toBeDefined();
    root?.exceptions.push({ ...root.exceptions[0]! });
    expect(() => selectAuditProject(value, process.cwd(), 'examples/pure-html', TODAY)).toThrow(
      'duplicate',
    );
    const unbound = structuredClone(model);
    if (unbound.projects['.']) unbound.projects['.'].exposureSha256 = null;
    expect(() => selectAuditProject(unbound, process.cwd(), 'examples/pure-html', TODAY)).toThrow(
      'exposure',
    );
  });

  it('fails a new GHSA instead of covering it by leaf package name', () => {
    const findings = findingsFromAudit(fixture('root'));
    const selected = selectAuditProject(model, process.cwd(), '.', TODAY);
    const changed = findings.map((finding) => ({ ...finding, id: FORGE }));
    expect(
      evaluateAuditGate(
        changed,
        { schemaVersion: 2, exceptions: selected.project.exceptions },
        TODAY,
      ).ok,
    ).toBe(false);
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
