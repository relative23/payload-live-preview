/**
 * H22 keeps copyable environment examples on the defaults of the tool that
 * evaluates them, and keeps framework-state claims narrower than a remount.
 * These checks read the public Markdown itself so a later prose edit cannot
 * silently restore the broken examples or the unqualified comparison.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function fences(markdown: string): string[] {
  return [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map((match) => match[1] ?? '');
}

function fenceContaining(path: string, needle: string): string {
  const found = fences(read(path)).find((fence) => fence.includes(needle));
  if (found === undefined) throw new Error(`${path} has no fenced example containing ${needle}`);
  return found;
}

describe('H22 documentation contract', () => {
  it.each([
    ['docs/vue.md', 'useLivePreviewDocument<Page>({', 'VITE_PAYLOAD_URL'],
    ['docs/html.md', 'initLivePreview({', 'VITE_PAYLOAD_ADMIN_ORIGIN'],
    ['docs/reveal.md', 'initLivePreview({', 'VITE_PAYLOAD_ADMIN_ORIGIN'],
  ])("%s uses Vite's default public environment prefix", (path, needle, name) => {
    const example = fenceContaining(path, needle);

    expect(example).toContain(`import.meta.env.${name}`);
    expect(example).not.toMatch(/import\.meta\.env\.PUBLIC_/u);
  });

  it('describes rerendering as identity-preserving and remounting as state-losing', () => {
    const react = read('docs/react.md');
    const vue = read('docs/vue.md');

    expect(react).toMatch(/stable component[\s\S]{0,80}identity preserves/u);
    expect(react).toMatch(/remount[\s\S]*loses/u);
    expect(vue).toMatch(/stable component[\s\S]{0,80}identity preserves/u);
    expect(vue).toMatch(/remount[\s\S]*loses/u);

    for (const prose of [read('README.md'), react, vue, read('docs/astro.md')]) {
      expect(prose).not.toMatch(
        /re-render(?:s|ed|ing)? the (?:component )?(?:sub)?tree and loses/u,
      );
      expect(prose).not.toContain('React replaces the subtree');
      expect(prose).not.toContain('a re-render does not');
    }
  });

  it('limits morph preservation to compatible retained nodes', () => {
    const prose = [read('README.md'), read('docs/hybrid.md'), read('docs/bindings.md')].join('\n');

    expect(prose).toMatch(/compatible[\s\S]*retained nodes/u);
    expect(prose).toMatch(/replaced[\s\S]*state/u);
    expect(prose).not.toContain('morphed in with focus and visitor state intact');
    expect(prose).not.toContain('survive, as with every keyed morph');
  });

  it('bounds the package comparison to the five cases the local pair of tests shares', () => {
    const react = read('docs/react.md');
    const vue = read('docs/vue.md');
    const upstreamProbe = read('scripts/check-upstream-findings.ts');

    expect(react).toMatch(/five cases[\s\S]*payload-hook-comparison\.test\.ts/u);
    expect(vue).toMatch(/same five cases/u);
    expect(react).not.toMatch(/same seven cases|seven cases did/u);
    expect(upstreamProbe).not.toContain('every row of the comparison in docs/react.md');
  });

  it('distinguishes the base Payload client, framework wrappers and optional peers', () => {
    const readme = read('README.md');
    const manifest = JSON.parse(read('package.json')) as { description?: string };

    expect(readme).toContain('`@payloadcms/live-preview`');
    expect(readme).toContain('`@payloadcms/live-preview-react`');
    expect(readme).toMatch(/no direct dependencies[\s\S]*optional peer/u);
    expect(manifest.description).toMatch(/no direct dependencies/u);
  });
});
