import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { capabilityUsesIn } from '../../../scripts/architecture-capabilities';
import {
  readArchitectureModules,
  type ArchitectureModule,
} from '../../../scripts/architecture-graph';
import { findCapabilityViolations } from '../../../scripts/architecture-rules';
import {
  countExportedDeclarations,
  countLines,
  findTrustedCoreViolations,
  measureTrustedCore,
} from '../../../scripts/check-trusted-core';
import {
  readTrustedCorePolicy,
  type TrustedCorePolicy,
} from '../../../scripts/trusted-core-policy';

/**
 * Three things have to hold for the trusted core to mean anything: the
 * scanner sees a capability where there is one and not where there is only a
 * name, the rule turns an unreviewed capability into a failure, and the
 * reviewed file matches the tree exactly — a ceiling with room under it is a
 * ceiling nobody notices touching.
 */

function scan(source: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return capabilityUsesIn(project.createSourceFile('src/x.ts', source)).map(({ kind, line }) => ({
    kind,
    line,
  }));
}

const policy = (): TrustedCorePolicy => ({
  schemaVersion: 1,
  core: {
    modules: {
      'src/core/data-merger.ts': ['network', 'credentialed-request'],
      'src/security/escape.ts': [],
    },
    lines: { limit: 10, why: 'test' },
    dependencies: {},
  },
  coreOnly: ['message-ingress', 'credentialed-request', 'trusted-types-policy'],
  outsideCore: {
    'src/fragment/handler.ts': { capabilities: ['network'], why: 'same-origin' },
  },
});

const module = (
  path: string,
  capabilities: ArchitectureModule['capabilities'],
): ArchitectureModule => ({ path, dependencies: [], capabilities });

describe('reading capabilities off the syntax', () => {
  it('sees a use of fetch, and not a declaration or a type that names it', () => {
    expect(
      scan(
        [
          "import type { X } from './x';",
          '/** a comment mentioning fetch */',
          'interface Options { readonly fetch?: typeof fetch; }',
          'export function a(options: Options): void { void (options.fetch ?? fetch)("u"); }',
          'export const b = typeof fetch === "function" ? fetch : undefined;',
          'export const c = { fetch: 1 };',
          'export const d = { fetch };',
          'export const e = globalThis.fetch;',
        ].join('\n'),
      ),
    ).toEqual([
      { kind: 'network', line: 4 },
      { kind: 'network', line: 5 },
      { kind: 'network', line: 7 },
      { kind: 'network', line: 8 },
    ]);
  });

  it('classifies the message, policy, sink, parse, load and navigation forms', () => {
    expect(
      scan(
        [
          "target.addEventListener('message', listener);",
          "target.addEventListener('click', listener);",
          'parent.postMessage(payload, origin);',
          "trustedTypes.createPolicy('name', { createHTML: (s) => s });",
          'element.innerHTML = trustedHtml(sanitizeHtml(html));',
          "element.insertAdjacentHTML('beforeend', html);",
          "new DOMParser().parseFromString(html, 'text/html');",
          "document.createElement('script');",
          "document.createElement('div');",
          'window.location.reload();',
          "element.setAttribute('href', url);",
          'img.src = url;',
          'el.style.backgroundImage = value;',
          "fetch(url, { credentials: 'include' });",
          "fetch(url, { credentials: 'same-origin' });",
        ].join('\n'),
      ),
    ).toEqual([
      { kind: 'message-ingress', line: 1 },
      { kind: 'message-egress', line: 3 },
      { kind: 'trusted-types-policy', line: 4 },
      { kind: 'html-sink', line: 5 },
      { kind: 'html-sink', line: 6 },
      { kind: 'html-parse', line: 7 },
      { kind: 'script-load', line: 8 },
      { kind: 'navigation', line: 10 },
      { kind: 'attribute-sink', line: 11 },
      { kind: 'attribute-sink', line: 12 },
      { kind: 'attribute-sink', line: 13 },
      { kind: 'network', line: 14 },
      { kind: 'credentialed-request', line: 14 },
      { kind: 'network', line: 15 },
    ]);
  });

  it('keys a sink on what is fed into it', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const [sink] = capabilityUsesIn(
      project.createSourceFile('src/x.ts', 'element.innerHTML =\n  trustedHtml(safe);'),
    );
    expect(sink?.site).toBe('trustedHtml(safe)');
  });
});

describe('holding every module to its reviewed capabilities', () => {
  const use = (kind: ArchitectureModule['capabilities'][number]['kind']) => ({
    kind,
    site: kind,
    line: 1,
  });

  it('fails a fetch in a renderer, and passes the reviewed same-origin one', () => {
    const modules = [
      module('src/core/data-merger.ts', [use('network'), use('credentialed-request')]),
      module('src/security/escape.ts', []),
      module('src/fragment/handler.ts', [use('network')]),
      module('src/field-types/text.ts', [use('network')]),
    ];
    expect(findCapabilityViolations(modules, policy()).map(({ message }) => message)).toEqual([
      'src/field-types/text.ts holds network and is neither in the trusted core nor reviewed for it in quality/trusted-core.json',
    ]);
  });

  it('refuses a core-only capability outside the core even with a review', () => {
    const reviewed: TrustedCorePolicy = {
      ...policy(),
      outsideCore: {
        'src/plugins/x.ts': { capabilities: ['credentialed-request'], why: 'no' },
      },
    };
    const modules = [
      module('src/core/data-merger.ts', [use('network'), use('credentialed-request')]),
      module('src/security/escape.ts', []),
      module('src/plugins/x.ts', [use('credentialed-request')]),
    ];
    expect(findCapabilityViolations(modules, reviewed).map(({ message }) => message)).toEqual([
      'src/plugins/x.ts holds credentialed-request, which only the trusted core may hold',
    ]);
  });

  it('keeps a core module to its list in both directions', () => {
    const modules = [
      module('src/core/data-merger.ts', [use('network'), use('html-sink')]),
      module('src/security/escape.ts', []),
      module('src/fragment/handler.ts', [use('network')]),
    ];
    expect(findCapabilityViolations(modules, policy()).map(({ message }) => message)).toEqual([
      'src/core/data-merger.ts holds html-sink, which quality/trusted-core.json does not list for it',
      'src/core/data-merger.ts no longer holds credentialed-request; remove it from quality/trusted-core.json',
    ]);
  });

  it('fails a stale review and a reviewed module that is gone', () => {
    const modules = [
      module('src/core/data-merger.ts', [use('network'), use('credentialed-request')]),
      module('src/security/escape.ts', []),
      module('src/fragment/handler.ts', []),
    ];
    expect(findCapabilityViolations(modules, policy()).map(({ message }) => message)).toEqual([
      'src/fragment/handler.ts no longer holds network; its review in quality/trusted-core.json is stale',
    ]);
    expect(
      findCapabilityViolations(modules.slice(0, 2), policy()).map(({ message }) => message),
    ).toEqual(['quality/trusted-core.json names src/fragment/handler.ts, which does not exist']);
  });

  it('leaves attribute writes outside the core to the sink inventory', () => {
    const modules = [
      module('src/core/data-merger.ts', [use('network'), use('credentialed-request')]),
      module('src/security/escape.ts', []),
      module('src/fragment/handler.ts', [use('network')]),
      module('src/core/a11y.ts', [use('attribute-sink')]),
    ];
    expect(findCapabilityViolations(modules, policy())).toEqual([]);
  });
});

describe('measuring the core', () => {
  it('counts lines the way wc does and declarations by export', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
    expect(countExportedDeclarations('export const a = 1;\nconst b = 2;\nexport { b };\n')).toBe(2);
  });

  it('fails on growth and on an import the review does not cover', () => {
    const measurement = {
      modules: ['src/core/data-merger.ts'],
      lines: { 'src/core/data-merger.ts': 11 },
      totalLines: 11,
      declarations: { 'src/core/data-merger.ts': 1 },
      totalDeclarations: 1,
      dependencies: ['src/core/diagnostics.ts'],
    };
    expect(findTrustedCoreViolations(measurement, policy())).toEqual([
      'the trusted core is 11 lines, above the reviewed 10',
      'the trusted core imports src/core/diagnostics.ts, which quality/trusted-core.json does not review',
    ]);
  });
});

describe('the reviewed core', () => {
  it('matches the tree exactly: modules, capabilities, lines and imports', async () => {
    const root = process.cwd();
    const reviewed = await readTrustedCorePolicy(root);
    const modules = await readArchitectureModules(root);
    const measurement = await measureTrustedCore(root, reviewed, modules);

    expect(findCapabilityViolations(modules, reviewed)).toEqual([]);
    expect(findTrustedCoreViolations(measurement, reviewed)).toEqual([]);
    // Exact, not "at most": a count is stable, so headroom would only be
    // room to grow into without writing down why.
    expect(measurement.totalLines).toBe(reviewed.core.lines.limit);
    expect(measurement.dependencies).toEqual(Object.keys(reviewed.core.dependencies).sort());
  });

  it('gives every module outside the core, and every import, a reason a reader can use', async () => {
    const reviewed = await readTrustedCorePolicy(process.cwd());
    expect(reviewed.core.lines.why.length).toBeGreaterThan(30);
    for (const [path, entry] of Object.entries(reviewed.outsideCore)) {
      expect(entry.why.length, path).toBeGreaterThan(30);
      expect(entry.capabilities.length, path).toBeGreaterThan(0);
    }
    for (const [path, why] of Object.entries(reviewed.core.dependencies)) {
      expect(why.length, path).toBeGreaterThan(30);
    }
  });

  it('keeps the core-only capabilities inside the core', async () => {
    const reviewed = await readTrustedCorePolicy(process.cwd());
    for (const entry of Object.values(reviewed.outsideCore)) {
      for (const kind of entry.capabilities) {
        expect(reviewed.coreOnly).not.toContain(kind);
      }
    }
  });
});
