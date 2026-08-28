import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepositoryFile = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('test runner policy', () => {
  it('fails focused unit tests and flaky browser tests in every environment', () => {
    const vitestConfig = readRepositoryFile('vitest.config.ts');
    const playwrightConfigs = [
      readRepositoryFile('playwright.config.ts'),
      readRepositoryFile('playwright.real-payload.config.ts'),
      readRepositoryFile('playwright.soak.config.ts'),
    ];

    expect(vitestConfig).toMatch(/allowOnly:\s*false/u);
    expect(vitestConfig).toMatch(/retry:\s*0/u);
    expect(vitestConfig).toMatch(/new ZeroSkipReporter\(\)/u);
    for (const config of playwrightConfigs) {
      expect(config).toMatch(/forbidOnly:\s*true/u);
      expect(config).toMatch(/failOnFlakyTests:\s*true/u);
      expect(config).toMatch(/playwright-zero-skip-reporter\.ts/u);
    }
  });

  it('keeps Stryker sandboxes outside the repository-wide ESLint project', () => {
    const eslintConfig = readRepositoryFile('eslint.config.js');

    expect(eslintConfig).toMatch(/ignores:\s*\[[\s\S]*['"]\.stryker-tmp\/\*\*['"]/u);
  });

  it('generates the runtime before any test run and never on consumer install', () => {
    const manifest = JSON.parse(readRepositoryFile('package.json')) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts['pretest']).toBe('npm run build:runtime');
    expect(manifest.scripts['test:architecture']).toContain('tsx scripts/workflow-contracts.ts');
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) {
      expect(manifest.scripts[hook]).toBeUndefined();
    }
  });
});
