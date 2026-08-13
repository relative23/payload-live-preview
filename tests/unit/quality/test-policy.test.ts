import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeTestSource,
  buildTestInventory,
  findStrykerVitestConfigViolations,
  groupForFile,
  serializeTestInventory,
} from '../../../scripts/test-policy';

const ROOT = resolve(import.meta.dirname, '../../..');

describe('test policy', () => {
  it('rejects every focused, skipped, todo and expected-failure declaration', () => {
    const source = `
      import { describe, it, test } from 'vitest';
      describe.only('focused suite', () => {});
      it.skip('skipped case', () => {});
      test.todo('unfinished case');
      test.fails('expected failure', () => {});
      test.skipIf(true)('conditional skip', () => {});
    `;

    expect(
      analyzeTestSource('fixture.test.ts', source).violations.map(({ modifier }) => modifier),
    ).toEqual(['only', 'skip', 'todo', 'fails', 'skipIf']);
  });

  it('rejects conditional runIf declarations because they can consume the skip budget', () => {
    const source = `
      import { describe, test } from 'vitest';
      test.runIf(false)('conditionally omitted test', () => {});
      describe.runIf(process.platform === 'linux')('conditional suite', () => {});
    `;

    expect(
      analyzeTestSource('fixture.test.ts', source).violations.map(({ modifier }) => modifier),
    ).toEqual(['runIf', 'runIf']);
  });

  it('rejects forbidden declarations reached through test-framework namespace imports', () => {
    const source = `
      import * as v from 'vitest';
      import * as pw from '@playwright/test';
      v.test.skip('vitest skip', () => {});
      pw.test.describe.only('focused browser suite', () => {});
    `;

    expect(
      analyzeTestSource('fixture.test.ts', source).violations.map(({ modifier }) => modifier),
    ).toEqual(['skip', 'only']);
  });

  it('rejects Playwright runtime skip/fail/fixme annotations through callback aliases', () => {
    const source = `
      import { test } from '@playwright/test';
      test('browser case', async ({ page }, info) => {
        const alias = info;
        info.skip(true, 'conditional skip');
        alias.fail(true, 'expected failure');
        alias.fixme();
        info.annotations.push({ type: 'allowed metadata' });
        await page.goto('/');
      });
    `;

    expect(
      analyzeTestSource('fixture.spec.ts', source).violations.map(({ modifier }) => modifier),
    ).toEqual(['skip', 'fail', 'fixme']);
  });

  it('rejects per-test retry and repeats options', () => {
    const source = `
      import { test } from 'vitest';
      test('retrying case', { retry: 3 }, () => {});
      test('repeated case', () => {}, { repeats: 10 });
    `;

    expect(
      analyzeTestSource('fixture.test.ts', source).violations.map(({ modifier }) => modifier),
    ).toEqual(['retry', 'repeats']);
  });

  it('rejects empty parameter tables and declarations hidden by control flow', () => {
    const source = `
      import { test } from 'vitest';
      test.each([])('empty table', () => {});
      if (process.platform === 'linux') test('inside if', () => {});
      true ? test('inside ternary', () => {}) : undefined;
      for (const value of [1]) test('inside loop', () => value);
      false && test('inside logical expression', () => {});
      switch (process.platform) {
        case 'never':
          test('inside switch clause', () => {});
      }
    `;

    expect(
      analyzeTestSource('fixture.test.ts', source).violations.map(({ modifier }) => modifier),
    ).toEqual([
      'empty-parameter-table',
      'conditional-registration',
      'conditional-registration',
      'conditional-registration',
      'conditional-registration',
      'conditional-registration',
    ]);
    expect(analyzeTestSource('fixture.test.ts', source).declarations).toHaveLength(5);
  });

  it('does not count empty or dynamic each/for tables as executable declarations', () => {
    const source = `
      import { test } from 'vitest';
      const emptyCases: unknown[] = [];
      test.each(emptyCases)('dynamic empty each', () => {});
      test.for([])('literal empty for', () => {});
      test.each(loadCases())('unknown dynamic each', () => {});
      test.each([1])('literal non-empty each', () => {});
      test.for([{ value: 1 }])('literal non-empty for', () => {});
    `;
    const analysis = analyzeTestSource('fixture.test.ts', source);

    expect(analysis.violations.map(({ modifier }) => modifier)).toEqual([
      'empty-parameter-table',
      'empty-parameter-table',
      'dynamic-parameter-table',
    ]);
    expect(analysis.declarations.map(({ title }) => title)).toEqual([
      'literal non-empty each',
      'literal non-empty for',
    ]);
  });

  it('recognises aliased imports and does not double-count parameterised declarations', () => {
    const source = `
      import { describe as context, test as check } from 'vitest';
      context('suite', () => {
        check.each([1, 2])('case %s', () => {});
      });
    `;

    expect(analyzeTestSource('fixture.test.ts', source).declarations).toEqual([
      { kind: 'suite', line: 3, title: 'suite' },
      { kind: 'test', line: 4, title: 'case %s' },
    ]);
  });

  it('treats Playwright control calls as controls rather than test declarations', () => {
    const source = `
      import { test } from '@playwright/test';
      test.describe('browser suite', () => {});
      test.describe.configure({ mode: 'serial' });
      test.use({ locale: 'de-DE' });
      test('browser case', async () => {});
    `;

    expect(analyzeTestSource('fixture.spec.ts', source).declarations).toEqual([
      { kind: 'suite', line: 3, title: 'browser suite' },
      { kind: 'test', line: 6, title: 'browser case' },
    ]);
  });

  it('does not assign an unowned test directory to the unit runner', () => {
    expect(groupForFile('tests/orphan/example.test.ts')).toBeUndefined();
  });

  it('pins Stryker to a dedicated Vitest config that only replaces reporters', () => {
    const strykerConfig = readFileSync(resolve(ROOT, 'stryker.config.js'), 'utf8');
    const vitestStrykerConfig = readFileSync(resolve(ROOT, 'vitest.stryker.config.ts'), 'utf8');

    expect(findStrykerVitestConfigViolations(strykerConfig, vitestStrykerConfig)).toEqual([]);

    expect(
      findStrykerVitestConfigViolations(
        strykerConfig.replace('vitest.stryker.config.ts', 'vitest.config.ts'),
        vitestStrykerConfig,
      ),
    ).toContain('Stryker must use vitest.stryker.config.ts');

    for (const [label, mutated] of [
      [
        'independent include',
        vitestStrykerConfig.replace(
          "reporters: ['default']",
          "include: ['tests/unit/**'],\n    reporters: ['default']",
        ),
      ],
      [
        'independent exclude',
        vitestStrykerConfig.replace(
          "reporters: ['default']",
          "exclude: ['tests/integration/**'],\n    reporters: ['default']",
        ),
      ],
      [
        'additional override',
        vitestStrykerConfig.replace(
          "reporters: ['default']",
          "retry: 1,\n    reporters: ['default']",
        ),
      ],
      ['missing base selection', vitestStrykerConfig.replace('...base.test,', '')],
    ] as const) {
      expect(findStrykerVitestConfigViolations(strykerConfig, mutated), label).not.toEqual([]);
    }
  });

  it('keeps the committed inventory byte-for-byte reproducible and policy-clean', async () => {
    const { inventory, violations } = await buildTestInventory(ROOT);
    const committed = readFileSync(resolve(ROOT, 'quality/test-inventory.json'), 'utf8');

    expect(violations).toEqual([]);
    expect(serializeTestInventory(inventory)).toBe(committed);
    expect(inventory.totals.files).toBeGreaterThan(0);
    expect(inventory.totals.tests).toBeGreaterThan(0);
    expect(inventory.runnerConfigs).toContain('playwright.soak.config.ts');
    expect(inventory.runnerConfigs).toContain('stryker.config.js');
    expect(inventory.runnerConfigs).toContain('vitest.config.ts');
    expect(inventory.runnerConfigs).toContain('vitest.stryker.config.ts');
    expect(inventory.groups.soak.files).toBeGreaterThan(0);
  });
});
