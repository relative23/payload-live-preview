import { describe, expect, it } from 'vitest';
import { CODEMODS, migrateSource } from '@migrate/index';

/**
 * `payload-live-preview/payload` merged into `payload-live-preview/plugin` in
 * 3.0 (ADR 0007, row 41): `buildLivePreviewUrl()` and its types are exported
 * there under the same names, so only the specifier changes. The codemod
 * rewrites it wherever a script names the entry as a module, and leaves the
 * same text alone where it is only a string.
 */

const ONLY = { only: ['move-payload-entry'] };

describe('move-payload-entry: where it rewrites the specifier', () => {
  it.each([
    [
      'an import, in the quotes the file uses',
      'import { buildLivePreviewUrl } from "payload-live-preview/payload";\n',
      'import { buildLivePreviewUrl } from "payload-live-preview/plugin";\n',
    ],
    [
      'a type import and a re-export',
      "import type { PathResolver } from 'payload-live-preview/payload';\nexport { buildLivePreviewUrl } from 'payload-live-preview/payload';\nexport * from 'payload-live-preview/payload';\n",
      "import type { PathResolver } from 'payload-live-preview/plugin';\nexport { buildLivePreviewUrl } from 'payload-live-preview/plugin';\nexport * from 'payload-live-preview/plugin';\n",
    ],
    [
      'a dynamic import and a require',
      "const a = await import('payload-live-preview/payload');\nconst b = require('payload-live-preview/payload');\n",
      "const a = await import('payload-live-preview/plugin');\nconst b = require('payload-live-preview/plugin');\n",
    ],
    [
      'a type that names the module',
      "type Options = import('payload-live-preview/payload').BuildLivePreviewUrlOptions;\n",
      "type Options = import('payload-live-preview/plugin').BuildLivePreviewUrlOptions;\n",
    ],
    [
      'an import beside one from the entry it moves into',
      "import { livePreview } from 'payload-live-preview/plugin';\nimport { buildLivePreviewUrl } from 'payload-live-preview/payload';\n",
      "import { livePreview } from 'payload-live-preview/plugin';\nimport { buildLivePreviewUrl } from 'payload-live-preview/plugin';\n",
    ],
  ])('rewrites %s', (_label, src, expected) => {
    const { output, conflicts, edits } = migrateSource(src, ONLY);
    expect(conflicts).toEqual([]);
    expect(output).toBe(expected);
    expect(edits.map((edit) => edit.codemod)).toEqual(['move-payload-entry']);
    expect(migrateSource(output, ONLY).output).toBe(output);
  });

  it('rewrites the frontmatter of an Astro file', () => {
    const src =
      "---\nimport { buildLivePreviewUrl } from 'payload-live-preview/payload';\n---\n<p>payload-live-preview/payload</p>\n";

    expect(migrateSource(src, { ...ONLY, fileName: 'Page.astro' }).output).toBe(
      "---\nimport { buildLivePreviewUrl } from 'payload-live-preview/plugin';\n---\n<p>payload-live-preview/payload</p>\n",
    );
  });
});

describe('move-payload-entry: what it leaves alone', () => {
  it.each([
    [
      'the same text as a plain string',
      "import { livePreview } from 'payload-live-preview/plugin';\nconsole.log('payload-live-preview/payload');\n",
    ],
    ['the entry it moves into', "import { livePreview } from 'payload-live-preview/plugin';\n"],
    [
      'another entry that starts the same way',
      "import { x } from 'payload-live-preview/payload-types';\nimport { y } from 'payload-live-preview';\n",
    ],
    ["another package's entry of that name", "import { z } from 'other-package/payload';\n"],
    [
      'a function of another name called with it',
      "import { livePreview } from 'payload-live-preview/plugin';\nload('payload-live-preview/payload');\n",
    ],
  ])('%s', (_label, src) => {
    expect(migrateSource(src, ONLY)).toEqual({ output: src, edits: [], conflicts: [] });
  });
});

describe('move-payload-entry: where it stands', () => {
  it('names its ledger row and runs before the codemods that read bindings', () => {
    const ids = CODEMODS.map((codemod) => codemod.id);
    expect(CODEMODS.find((codemod) => codemod.id === 'move-payload-entry')?.ledgerEntry).toBe(41);
    expect(ids[0]).toBe('move-payload-entry');
  });
});
