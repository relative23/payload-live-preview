import { describe, expect, it } from 'vitest';
import { CODEMODS, migrateSource } from '@migrate/index';
import * as clientEntry from '@/client-entry';
import * as rootEntry from '@/index';

/**
 * `payload-live-preview/client` is the one browser entry since 3.0 (ADR 0007,
 * row 46): `/plugins` and `/structural` moved into it whole, and `/core` with
 * every name that runs in a browser. What `/core` also exported for a server
 * (the binding helpers, the CSP helpers, the authorization guard) is on the
 * root alone, so its codemod decides by the names a declaration takes.
 */

const CORE = { only: ['move-core-entry'] };

describe('the entries that moved into `/client` whole', () => {
  it.each([
    [
      'move-plugins-entry',
      "import { PluginManager, type LivePreviewPlugin } from 'payload-live-preview/plugins';\nconst lazy = await import('payload-live-preview/plugins');\n",
      "import { PluginManager, type LivePreviewPlugin } from 'payload-live-preview/client';\nconst lazy = await import('payload-live-preview/client');\n",
    ],
    [
      'move-structural-entry',
      'import { morphElement, type MorphOptions } from "payload-live-preview/structural";\n',
      'import { morphElement, type MorphOptions } from "payload-live-preview/client";\n',
    ],
  ])('%s rewrites the specifier alone', (id, src, expected) => {
    const { output, conflicts, edits } = migrateSource(src, { only: [id] });

    expect(conflicts).toEqual([]);
    expect(output).toBe(expected);
    expect(edits.map((edit) => edit.codemod)).toEqual([id]);
    expect(migrateSource(output, { only: [id] }).output).toBe(output);
  });
});

describe('move-core-entry: where a declaration goes', () => {
  it.each([
    [
      'browser names, to `/client`',
      "import { initLivePreview, createDocumentSession, type DocumentSession } from 'payload-live-preview/core';\n",
      "import { initLivePreview, createDocumentSession, type DocumentSession } from 'payload-live-preview/client';\n",
    ],
    [
      'only server names, to the root',
      "import { bind, generateCspNonce } from 'payload-live-preview/core';\nimport type { FieldName } from 'payload-live-preview/core';\n",
      "import { bind, generateCspNonce } from 'payload-live-preview';\nimport type { FieldName } from 'payload-live-preview';\n",
    ],
    [
      'a renamed binding, by the name the entry exports',
      "import { bind as attributes } from 'payload-live-preview/core';\nexport { sanitizeHtml as clean } from 'payload-live-preview/core';\n",
      "import { bind as attributes } from 'payload-live-preview';\nexport { sanitizeHtml as clean } from 'payload-live-preview/client';\n",
    ],
    [
      'the module taken whole, to `/client`',
      "import * as preview from 'payload-live-preview/core';\nexport * from 'payload-live-preview/core';\nconst a = await import('payload-live-preview/core');\nconst b = require('payload-live-preview/core');\n",
      "import * as preview from 'payload-live-preview/client';\nexport * from 'payload-live-preview/client';\nconst a = await import('payload-live-preview/client');\nconst b = require('payload-live-preview/client');\n",
    ],
    [
      'a type that names the module, by the name it takes',
      "type Scope = import('payload-live-preview/core').AuthorizedPreviewPayloadScope;\ntype Session = import('payload-live-preview/core').DocumentSession;\n",
      "type Scope = import('payload-live-preview').AuthorizedPreviewPayloadScope;\ntype Session = import('payload-live-preview/client').DocumentSession;\n",
    ],
  ])('sends %s', (_label, src, expected) => {
    const { output, conflicts } = migrateSource(src, CORE);

    expect(conflicts).toEqual([]);
    expect(output).toBe(expected);
    expect(migrateSource(output, CORE).output).toBe(output);
  });

  it('leaves a declaration that mixes both and says which name goes where', () => {
    const src =
      "import { OriginDetector } from 'payload-live-preview/core';\nimport { initLivePreview, bind, type FieldName } from 'payload-live-preview/core';\n";

    const { output, conflicts } = migrateSource(src, CORE);

    expect(output).toBe(
      "import { OriginDetector } from 'payload-live-preview/client';\nimport { initLivePreview, bind, type FieldName } from 'payload-live-preview/core';\n",
    );
    expect(conflicts).toEqual([
      {
        codemod: 'move-core-entry',
        reason:
          '`payload-live-preview/core` is gone and its names are in two entries now: take initLivePreview from `payload-live-preview/client` and bind, FieldName from `payload-live-preview`',
        line: 2,
      },
    ]);
  });

  it.each([
    'bind',
    'bindByPath',
    'buildFrameAncestors',
    'createPreviewBindings',
    'generateCspNonce',
    'isAuthorizedPreviewContext',
  ])('sends %s to the root, where the entries have it and `/client` does not', (name) => {
    expect(name in rootEntry).toBe(true);
    expect(name in clientEntry).toBe(false);
    expect(
      migrateSource(`import { ${name} } from 'payload-live-preview/core';\n`, CORE).output,
    ).toBe(`import { ${name} } from 'payload-live-preview';\n`);
  });
});

describe('the three codemods: where they stand', () => {
  it('name row 46 and run with the other moved entry, before the codemods that read bindings', () => {
    const ids = CODEMODS.map((codemod) => codemod.id);

    expect(ids.slice(0, 4)).toEqual([
      'move-payload-entry',
      'move-core-entry',
      'move-plugins-entry',
      'move-structural-entry',
    ]);
    expect(CODEMODS.slice(1, 4).map((codemod) => codemod.ledgerEntry)).toEqual([46, 46, 46]);
  });
});
