/**
 * A barrel that holds logic hides it from coverage and mutation, which both
 * leave `index.ts` out. The rule is proven here on small sources; the
 * architecture policy holds it against every barrel in the repository.
 */
import { describe, expect, it } from 'vitest';
import { findBarrelViolations, isBarrel } from '../../../scripts/barrel-rules';

function violationsFor(path: string, source: string): readonly string[] {
  return findBarrelViolations([path], () => source).map(({ message }) => message);
}

describe('barrel rules', () => {
  it('takes an index.ts under src for a barrel, at any depth, and nothing else', () => {
    expect(isBarrel('src/index.ts')).toBe(true);
    expect(isBarrel('src/runtime/client/index.ts')).toBe(true);
    expect(isBarrel('src/tools/codegen/annotate/index.ts')).toBe(true);
    expect(isBarrel('src/runtime/client/reindex.ts')).toBe(false);
    expect(isBarrel('src/runtime/client/index.tsx')).toBe(false);
    expect(isBarrel('scripts/index.ts')).toBe(false);
  });

  it('accepts every form of re-export', () => {
    const source = [
      '/** A header comment. */',
      "export { a, b as c } from './a';",
      "export type { T } from './types';",
      "export * from './all';",
      "export * as named from './named';",
    ].join('\n');

    expect(violationsFor('src/runtime/client/index.ts', source)).toEqual([]);
  });

  it('refuses a declaration, and says how many statements and where the first one is', () => {
    const source = [
      "import { helper } from './helper';",
      '',
      'export class Client {}',
      'export function init(): Client {',
      '  return helper(new Client());',
      '}',
      "export { other } from './other';",
    ].join('\n');

    expect(violationsFor('src/runtime/client/index.ts', source)).toEqual([
      'src/runtime/client/index.ts holds 3 statement(s) that are not re-exports, the first (ImportDeclaration) ' +
        'at line 1; a barrel only re-exports, move them to a module beside it',
    ]);
  });

  it('refuses a local export list, a type declaration and a type-only import', () => {
    expect(violationsFor('src/a/index.ts', "import { x } from './x';\nexport { x };")).toHaveLength(
      1,
    );
    expect(violationsFor('src/a/index.ts', 'export interface Options {}')).toHaveLength(1);
    expect(violationsFor('src/a/index.ts', "import type { T } from './t';")).toHaveLength(1);
  });

  it('leaves a module that is not a barrel alone', () => {
    expect(violationsFor('src/runtime/client/config.ts', 'export const value = 1;')).toEqual([]);
  });
});
