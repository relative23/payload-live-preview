/**
 * The replay takes its files from the README, so the README's own shape is a
 * contract: each framework's quickstart names the files a project writes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { quickstartFiles } from '../../../scripts/quickstart-blocks';

const readme = readFileSync('README.md', 'utf8');
const paths = (heading: string): readonly string[] =>
  quickstartFiles(readme, heading).map((file) => file.path);

describe('the quickstarts of the README', () => {
  it('name the files a project writes, per framework', () => {
    expect(paths('Astro')).toEqual(['astro.config.mjs']);
    expect(paths('Next.js (App Router)')).toEqual(['app/layout.tsx']);
    expect(paths('SvelteKit')).toEqual(['src/env.ts', 'src/hooks.server.ts']);
    expect(paths('Nuxt')).toEqual(['nuxt.config.ts', 'server/utils/live-preview-auth.ts']);
    expect(paths('Plain HTML')).toEqual(['build.ts']);
  });

  it('hands each block over as the page has it', () => {
    const [config] = quickstartFiles(readme, 'Astro');
    expect(config?.content.startsWith('// astro.config.mjs\nimport { defineConfig }')).toBe(true);
    expect(config?.content.endsWith('});\n')).toBe(true);
  });
});

describe('reading a quickstart', () => {
  const page = (body: string): string =>
    `# x\n\n## Quick start\n\n${body}\n## Frameworks\n\n### Astro\n`;

  it('stops at the next heading and takes a remark after the path', () => {
    const body =
      '### A\n\n```ts\n// build.ts — runs at build time\nconst a = 1;\n```\n\n### B\n\n```ts\n// b.ts\n```\n';
    expect(quickstartFiles(page(body), 'A')).toEqual([
      { path: 'build.ts', content: '// build.ts — runs at build time\nconst a = 1;\n' },
    ]);
  });

  it('refuses a block that names no file, a heading that is not there, and one without a block', () => {
    expect(() => quickstartFiles(page('### A\n\n```ts\nconst a = 1;\n```\n'), 'A')).toThrow(
      'a code block under "### A" does not open with a comment naming its file',
    );
    expect(() => quickstartFiles(page('### A\n\ntext\n'), 'B')).toThrow(
      'the quick start has no "### B"',
    );
    expect(() => quickstartFiles(page('### A\n\ntext\n'), 'A')).toThrow(
      '"### A" has no code block',
    );
    expect(() => quickstartFiles('# x\n', 'A')).toThrow(
      'the README has no "## Quick start" section',
    );
  });
});
