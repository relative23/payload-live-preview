/**
 * ADR 0007's 2.0 gate, "migration verified in two materially different apps" —
 * app two: the Next.js fixture as it stood at v1.8.1.
 *
 * `tests/migration/nextjs-1.8.1/source/` holds the three files of that fixture
 * that carry the live-preview integration, byte for byte from the tag.
 * `expected/` is the same app after the upgrade, as measured on 2026-09-11
 * against the packed 2.0 build: `pll migrate` changed nothing, and a human added
 * one line. Upgraded that way the app passed the Next.js live-preview scenarios,
 * with `inspect().hydration` at `{ mode: 'react', state: 'committed' }`; without
 * the line React threw `Hydration failed` on every framed load and took the
 * first write back (ADR 0015). The numbers are in the ADR 0007 addendum.
 *
 * This file keeps the upgrade that small. A codemod that starts touching the
 * app, a name the app imports going missing, or the one line no longer being
 * what makes the difference turns it red.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Node as MorphNode } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import * as rootEntry from '@/index';
import { generateInlineScript, type InlineScriptConfig } from '@/inline/generator';
import { livePreviewScriptProps } from '@adapters/nextjs/index';
import { loadTsMorph, packageBindings, parseScript } from '@migrate/ast';
import { runMigrate } from '@migrate/runner';

const ROOT = resolve(import.meta.dirname, '../../..');
const SNAPSHOT = join(ROOT, 'tests/migration/nextjs-1.8.1');
const SOURCE = join(SNAPSHOT, 'source');
const EXPECTED = join(SNAPSHOT, 'expected');
const FIXTURE = join(ROOT, 'examples/nextjs-payload/app');

/** The line the upgrade needed from a human, as measured. */
const HAND_EDIT = "  hydration: 'react',\n";

const read = (path: string): Promise<string> => readFile(path, 'utf8');

/** The first line of a generated script: the serialized configuration. */
const configLine = (script: string): string => script.slice(0, script.indexOf('\n'));

/** A literal as its value; anything else as the source text it refers to. */
function literalValue(node: MorphNode): unknown {
  const { Node, SyntaxKind } = loadTsMorph();
  if (Node.isAsExpression(node) || Node.isParenthesizedExpression(node)) {
    return literalValue(node.getExpression());
  }
  if (Node.isStringLiteral(node) || Node.isNumericLiteral(node)) return node.getLiteralValue();
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  if (node.getKind() === SyntaxKind.FalseKeyword) return false;
  if (Node.isArrayLiteralExpression(node)) return node.getElements().map(literalValue);
  if (Node.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.getProperties().map((property): [string, unknown] => {
        if (Node.isPropertyAssignment(property)) {
          return [property.getName(), literalValue(property.getInitializerOrThrow())];
        }
        if (Node.isShorthandPropertyAssignment(property)) {
          return [property.getName(), { reference: property.getName() }];
        }
        throw new Error(`unexpected ${property.getKindName()} in an options literal`);
      }),
    );
  }
  return { reference: node.getText() };
}

// `parseScript` reuses one in-memory file, so each helper reads what it needs
// before the next parse replaces it.

/** The options literal a layout hands `generateInlineScript()`. */
async function inlineScriptOptions(path: string): Promise<Record<string, unknown>> {
  const { SyntaxKind } = loadTsMorph();
  const script = parseScript(await read(path), 'tsx');
  const call = script
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((candidate) => candidate.getExpression().getText() === 'generateInlineScript');
  const [options] = call?.getArguments() ?? [];
  if (options === undefined) throw new Error(`${path}: no generateInlineScript() call`);
  return literalValue(options) as Record<string, unknown>;
}

/** The value a module-scope `const` is initialised with. */
async function constValue(path: string, name: string): Promise<Record<string, unknown>> {
  const script = parseScript(await read(path), 'tsx');
  const initializer = script.getVariableDeclarationOrThrow(name).getInitializerOrThrow();
  return literalValue(initializer) as Record<string, unknown>;
}

/** `specifier name` for every name a file binds from the package. */
async function packageImports(path: string): Promise<string[]> {
  const script = parseScript(await read(path), 'tsx');
  return packageBindings(script).map((binding) => `${binding.specifier} ${binding.imported}`);
}

function pick(object: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

describe('app two: the Next.js fixture at v1.8.1, upgraded to 2.0', () => {
  it('pll migrate reads the three files and has nothing to rewrite or flag in them', async () => {
    const result = await runMigrate(SOURCE);

    expect(result.files.map((file) => file.file)).toEqual([
      'app/layout.tsx',
      'app/page.tsx',
      'next.config.mjs',
    ]);
    expect(result.changedCount).toBe(0);
    expect(result.conflictCount).toBe(0);
  });

  it('every name the app imports from the package is still exported by 2.0', async () => {
    const imports = [
      ...(await packageImports(join(SOURCE, 'app/layout.tsx'))),
      ...(await packageImports(join(SOURCE, 'app/page.tsx'))),
    ];

    // The whole 1.x surface this app touches: one name, from the root entry.
    expect(imports).toEqual(['payload-live-preview generateInlineScript']);
    expect(Object.keys(rootEntry)).toContain('generateInlineScript');
  });

  it('after the codemod a human added one line, to one file', async () => {
    const before = await read(join(SOURCE, 'app/layout.tsx'));
    const after = await read(join(EXPECTED, 'app/layout.tsx'));

    expect(after).not.toBe(before);
    expect(after.replace(HAND_EDIT, '')).toBe(before);
    for (const file of ['app/page.tsx', 'next.config.mjs']) {
      expect(await read(join(EXPECTED, file))).toBe(await read(join(SOURCE, file)));
    }
  });

  it('the line is what React needs: without it the script does not wait for hydration', async () => {
    const before = await inlineScriptOptions(join(SOURCE, 'app/layout.tsx'));
    const after = await inlineScriptOptions(join(EXPECTED, 'app/layout.tsx'));

    // Both are the configuration the upgraded app served, read back with curl —
    // plus the `defaults` marker every script has carried since (Z37, slot 24).
    expect(configLine(generateInlineScript(before as InlineScriptConfig))).toBe(
      'var __LIVE_PREVIEW_CONFIG__=[["http://localhost:4174"],,,,true,25,,,,,,,,,,,,,,,,,,,"v2"];',
    );
    expect(configLine(generateInlineScript(after as InlineScriptConfig))).toBe(
      'var __LIVE_PREVIEW_CONFIG__=[["http://localhost:4174"],,,,true,25,,,,,,,,,,,,,,,,,,"react","v2"];',
    );
  });

  it('and it is the configuration the Next.js adapter writes without being asked', async () => {
    const after = await inlineScriptOptions(join(EXPECTED, 'app/layout.tsx'));
    const { hydration, ...rest } = after;
    const adapter = livePreviewScriptProps(rest);

    expect(hydration).toBe('react');
    expect(configLine(adapter.dangerouslySetInnerHTML.__html)).toBe(
      configLine(generateInlineScript(after as InlineScriptConfig)),
    );
  });

  it("the bound page is the page today's fixture renders, byte for byte", async () => {
    expect(await read(join(EXPECTED, 'app/page.tsx'))).toBe(
      await read(join(FIXTURE, '(inline)/page.tsx')),
    );
  });

  it("today's fixture goes further than the upgrade, and this is how far", async () => {
    const upgraded = await inlineScriptOptions(join(EXPECTED, 'app/layout.tsx'));
    const fixture = await constValue(join(FIXTURE, '(inline)/layout.tsx'), 'previewOptions');
    const byName = (a: string, b: string): number => a.localeCompare(b);
    const shared = Object.keys(upgraded).filter((key) => key in fixture);

    // What both configure, they configure alike.
    expect(shared).toEqual(['allowedOrigins', 'debug', 'debounceMs']);
    expect(pick(fixture, shared)).toEqual(pick(upgraded, shared));
    // `hydration` the fixture leaves to the adapter it renders through.
    expect(Object.keys(upgraded).filter((key) => !(key in fixture))).toEqual(['hydration']);
    // The rest the upgrade does not deliver: a gate that renders nothing for an
    // anonymous visitor, the fragment strategy, and the reveal.
    expect(
      Object.keys(fixture)
        .filter((key) => !(key in upgraded))
        .sort(byName),
    ).toEqual(['authorizePreview', 'fragments', 'inject', 'revealEditedField']);
    expect(await packageImports(join(FIXTURE, '(inline)/layout.tsx'))).toEqual([
      'payload-live-preview/nextjs LivePreviewScript',
    ]);
  });
});
