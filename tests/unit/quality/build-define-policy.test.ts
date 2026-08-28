import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_DEFINES, findBuildDefineViolations } from '../../../scripts/build-define-policy';

const ROOT = resolve(import.meta.dirname, '../../..');

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.generated.ts')) found.push(path);
  }
  return found;
}

describe('build define folding', () => {
  it('accepts every shape esbuild can fold', () => {
    const source = `
      declare const __INLINE_BUILD__: boolean | undefined;
      if (typeof __INLINE_BUILD__ !== 'undefined' && __INLINE_BUILD__) run();
      if (typeof __INLINE_BUILD__ === 'undefined' || !__INLINE_BUILD__) other();
      const value = __INLINE_BUILD__ ? 1 : 2;
    `;
    expect(findBuildDefineViolations('fixture.ts', source)).toEqual([]);
  });

  it('rejects a define copied into a const before the branch reads it', () => {
    const source = `
      declare const __INLINE_BUILD__: boolean | undefined;
      const inline = __INLINE_BUILD__ === true;
      if (inline) run();
    `;
    expect(findBuildDefineViolations('fixture.ts', source).map(({ line }) => line)).toEqual([3]);
  });

  it('rejects a define passed as an argument or returned', () => {
    const source = `
      declare const __INLINE_BUILD__: boolean | undefined;
      export function isInline(): boolean { return __INLINE_BUILD__ === true; }
      configure({ inline: __INLINE_BUILD__ });
    `;
    expect(findBuildDefineViolations('fixture.ts', source)).toHaveLength(2);
  });

  it('keeps every build define in the shipped sources at its branch', () => {
    const violations = sourceFiles(resolve(ROOT, 'src')).flatMap((path) =>
      findBuildDefineViolations(
        relative(ROOT, path).replaceAll('\\', '/'),
        readFileSync(path, 'utf8'),
      ),
    );
    expect(violations.map(({ message }) => message)).toEqual([]);
    expect(BUILD_DEFINES).toContain('__INLINE_BUILD__');
  });
});
