import { describe, expect, it } from 'vitest';
import {
  codeSpans,
  exportedNames,
  importsIn,
  measureSurfaceUsage,
  reportFor,
  splitSurface,
} from '../../../scripts/surface-usage';

/**
 * The public/internal split in the API reports rests on this measurement, so
 * the three readers it is made of have to read what they claim to: the names
 * a report exports, the names an example imports, the code a guide shows.
 */

describe('reading the surface', () => {
  it('lists every exported name of a report, re-exports and defaults included', () => {
    const report = [
      '// @public',
      'export function a(): void;',
      'export declare const B: number;',
      'export interface C {',
      '    readonly d: string;',
      '}',
      'export type E = string;',
      'export { F }',
      'export { G as H }',
      'export default I;',
    ].join('\n');

    expect(exportedNames(report)).toEqual(['a', 'B', 'C', 'E', 'F', 'H', 'default']);
  });

  it('maps a specifier to its report and reads named imports, types and aliases', () => {
    expect(reportFor('payload-live-preview')).toBe('payload-live-preview.api.md');
    expect(reportFor('payload-live-preview/codegen/astro')).toBe(
      'payload-live-preview--codegen--astro.api.md',
    );
    expect(
      importsIn(
        [
          "import { a, type B, c as d } from 'payload-live-preview/astro';",
          'import type { E } from "payload-live-preview";',
          "import { f } from 'some-other-package';",
        ].join('\n'),
      ),
    ).toEqual([
      ['payload-live-preview--astro.api.md', ['a', 'B', 'c']],
      ['payload-live-preview.api.md', ['E']],
    ]);
  });

  it('keeps only the code a reader copies from a guide', () => {
    const markdown = [
      'Prose naming `inlineName` and a `second one`.',
      '```ts',
      'fenced();',
      '```',
      'More prose with noCode here.',
    ].join('\n');
    const code = codeSpans(markdown);
    expect(code).toContain('fenced();');
    expect(code).toContain('inlineName');
    expect(code).not.toContain('noCode');
  });

  it('splits used from unused, per report and per distinct name', () => {
    const split = splitSurface({
      entries: {
        'a.api.md': {
          X: { examples: ['examples/one.ts'], docs: [] },
          Y: { examples: [], docs: ['docs/guide.md'] },
          Z: { examples: [], docs: [] },
        },
        'b.api.md': { X: { examples: [], docs: [] } },
      },
    });
    expect(split).toEqual({
      total: 4,
      importedByExamples: 1,
      namedInDocs: 1,
      used: 2,
      unused: 2,
      distinct: { total: 3, used: 2 },
    });
  });

  it('measures the repository without an example importing a name no report exports', async () => {
    const usage = await measureSurfaceUsage(process.cwd());
    const split = splitSurface(usage);
    expect(split.total).toBeGreaterThan(0);
    expect(split.importedByExamples).toBeGreaterThan(0);
    expect(split.namedInDocs).toBeGreaterThan(split.importedByExamples);
  });
});
