/** Where the script lives in a file: the whole file, or the script blocks of a component. */
import { extname } from 'node:path';
import type { ScriptKind } from './ast';

export interface ScriptBlock {
  readonly start: number;
  readonly end: number;
  readonly kind: ScriptKind;
}

const WHOLE_FILE: Readonly<Record<string, ScriptKind>> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
};
const COMPONENT_EXTENSIONS = new Set(['.astro', '.vue', '.svelte']);
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/u;
// Browsers close a script on `</script` followed by anything up to `>`, so the
// end tag must accept that too, or a stray `</script foo>` would swallow the
// rest of the file into one block.
const SCRIPT_TAG = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script\b[^>]*>/giu;

export function scriptBlocks(source: string, fileName: string): readonly ScriptBlock[] {
  const extension = extname(fileName).toLowerCase();
  if (!COMPONENT_EXTENSIONS.has(extension)) {
    return [{ start: 0, end: source.length, kind: WHOLE_FILE[extension] ?? 'ts' }];
  }
  const blocks: ScriptBlock[] = [];
  const frontmatter = extension === '.astro' ? FRONTMATTER.exec(source) : null;
  if (frontmatter?.[1] !== undefined) {
    const start = frontmatter.index + frontmatter[0].indexOf('\n') + 1;
    blocks.push({ start, end: start + frontmatter[1].length, kind: 'ts' });
  }
  for (const match of source.matchAll(SCRIPT_TAG)) {
    const body = match[1] ?? '';
    if (body.trim() === '') continue;
    const start = match.index + match[0].lastIndexOf(body);
    blocks.push({ start, end: start + body.length, kind: 'ts' });
  }
  return blocks;
}
