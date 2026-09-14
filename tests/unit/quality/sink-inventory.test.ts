import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { capabilityUsesIn } from '../../../scripts/architecture-capabilities';
import {
  readArchitectureModules,
  type ArchitectureModule,
} from '../../../scripts/architecture-graph';
import { ATTRIBUTE_SINKS, HTML_SINKS } from '../../../scripts/sink-inventory';
import {
  findSinkViolations,
  SINK_INVENTORY,
  type SinkInventory,
} from '../../../scripts/sink-rules';

/**
 * Every `innerHTML` write in the package, and every attribute write that could
 * carry a URL or a style, is accounted for in `scripts/sink-inventory.ts` with
 * the justification that applies. The gate forces that review; these tests
 * hold the gate: it sees the sinks at all, it fails the ones the inventory
 * does not cover, and the inventory matches the tree it describes.
 */

const ROOT = process.cwd();

function moduleFrom(path: string, source: string): ArchitectureModule {
  const project = new Project({ useInMemoryFileSystem: true });
  return {
    path,
    dependencies: [],
    capabilities: capabilityUsesIn(project.createSourceFile(path, source)),
  };
}

function violationsOf(
  modules: readonly ArchitectureModule[],
  sources: Readonly<Record<string, string>>,
  inventory: SinkInventory = { html: new Map(), attribute: new Map() },
): readonly string[] {
  return findSinkViolations(modules, inventory, (path) => sources[path] ?? '').map(
    ({ message }) => message,
  );
}

describe('the sink gate', () => {
  it('fails a raw innerHTML write in a renderer, and an unlisted one behind trustedHtml', () => {
    const source = [
      'export function render(element: Element, value: string): void {',
      '  element.innerHTML = value;',
      '  element.innerHTML = trustedHtml(value);',
      '}',
    ].join('\n');
    expect(
      violationsOf([moduleFrom('src/field-types/x.ts', source)], {
        'src/field-types/x.ts': source,
      }),
    ).toEqual([
      'src/field-types/x.ts::trustedHtml(value) is an HTML sink the inventory does not list',
      'src/field-types/x.ts::value is an HTML sink the inventory does not list',
      'src/field-types/x.ts::value writes markup without trustedHtml(); the page would break under a Trusted Types CSP',
    ]);
  });

  it('holds a listed sink to the evidence its justification needs', () => {
    const source = 'host.innerHTML = trustedHtml(html);';
    const inventory: SinkInventory = {
      html: new Map([['src/core/x.ts::trustedHtml(html)', 'trusted-origin']]),
      attribute: new Map(),
    };
    expect(
      violationsOf([moduleFrom('src/core/x.ts', source)], { 'src/core/x.ts': source }, inventory),
    ).toEqual([
      'src/core/x.ts::trustedHtml(html) is reviewed as trusted-origin and must parse into a <template>, not a live element',
    ]);
  });

  it('refuses a handler or srcdoc by name, needs a review for href, style and computed names, and lets aria through', () => {
    const source = [
      "element.setAttribute('onclick', value);",
      "element.setAttribute('srcdoc', value);",
      "element.setAttribute('href', value);",
      "element.setAttribute('style', value);",
      'element.setAttribute(name, value);',
      'img.src = value;',
      'el.style.color = value;',
      "element.setAttribute('aria-label', value);",
      "element.setAttribute('data-payload-field', value);",
    ].join('\n');
    expect(
      violationsOf([moduleFrom('src/field-types/x.ts', source)], {
        'src/field-types/x.ts': source,
      }),
    ).toEqual([
      'src/field-types/x.ts::el.style.color = value writes style and the inventory does not list it',
      "src/field-types/x.ts::element.setAttribute('href', value) writes href and the inventory does not list it",
      "src/field-types/x.ts::element.setAttribute('onclick', value) writes onclick, which nothing in this package may write",
      "src/field-types/x.ts::element.setAttribute('srcdoc', value) writes srcdoc, which nothing in this package may write",
      "src/field-types/x.ts::element.setAttribute('style', value) writes style and the inventory does not list it",
      'src/field-types/x.ts::element.setAttribute(name, value) computes the attribute it writes and the inventory does not list it',
      'src/field-types/x.ts::img.src = value writes src and the inventory does not list it',
    ]);
  });

  it('keeps a justification to the kind of write it covers, and asks url-validated for the check', () => {
    const source = "element.setAttribute('href', value);\nelement.setAttribute(name, value);";
    const inventory: SinkInventory = {
      html: new Map(),
      attribute: new Map([
        ["src/field-types/x.ts::element.setAttribute('href', value)", 'url-validated'],
        ['src/field-types/x.ts::element.setAttribute(name, value)', 'constant'],
      ]),
    };
    expect(
      violationsOf(
        [moduleFrom('src/field-types/x.ts', source)],
        { 'src/field-types/x.ts': source },
        inventory,
      ),
    ).toEqual([
      "src/field-types/x.ts::element.setAttribute('href', value) is reviewed as url-validated and must check the URL with isSafeUrl or acceptUrl in the same module",
      'src/field-types/x.ts::element.setAttribute(name, value) is reviewed as constant, which does not cover a computed name',
    ]);
  });

  it('fails a review whose site is gone', () => {
    const inventory: SinkInventory = {
      html: new Map([['src/gone.ts::trustedHtml(x)', 'sanitised']]),
      attribute: new Map(),
    };
    expect(violationsOf([], {}, inventory)).toEqual([
      'src/gone.ts::trustedHtml(x) is reviewed but no longer exists as written',
    ]);
  });
});

describe('the reviewed inventory', () => {
  // The scan reads every module through ts-morph: 0.75 s alone on this host and
  // 1.2 s under coverage, but 5.0 s inside a full parallel coverage run, and the
  // file took 5.5 s in CI's Coverage job on #93 — against vitest's 5 s default.
  // That is CPU contention, not a hang, so the ceiling moves, not the test.
  it('finds the sinks at all', async () => {
    // Guards the scanner itself: a scan that silently matched nothing would
    // make the assertion below vacuous.
    const modules = await readArchitectureModules(ROOT);
    const html = modules.flatMap(({ capabilities }) =>
      capabilities.filter(({ kind }) => kind === 'html-sink'),
    );
    const attribute = modules.flatMap(({ capabilities }) =>
      capabilities.filter(({ kind }) => kind === 'attribute-sink'),
    );
    expect(html.length).toBe(HTML_SINKS.size);
    expect(attribute.length).toBeGreaterThan(ATTRIBUTE_SINKS.size);
  }, 30_000);

  it('accounts for every sink in the tree, and for nothing that is not there', async () => {
    const modules = await readArchitectureModules(ROOT);
    expect(
      findSinkViolations(modules, SINK_INVENTORY, (path) =>
        readFileSync(resolve(ROOT, path), 'utf8'),
      ),
    ).toEqual([]);
  });

  it('keeps the sanitizer as the only sink fed markup it did not check, besides the server render', () => {
    const raw = [...HTML_SINKS.entries()].filter(
      ([, justification]) => justification === 'inert-parse' || justification === 'trusted-origin',
    );
    expect(raw.map(([key]) => key)).toEqual([
      'src/security/sanitizer.ts::trustedHtml(html)',
      'src/core/strategy-runner.ts::trustedHtml(html)',
    ]);
  });
});
