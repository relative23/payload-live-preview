import { describe, expect, it } from 'vitest';
import { CODEMODS, migrateSource } from '@migrate/index';

/**
 * The 1.x → 2.0 codemods (roadmap 1.9.0, ADR 0007). Each rewrites only this
 * package's own API surface, is idempotent, and leaves an unrelated
 * identifier of the consumer's own alone.
 */

describe('codemods', () => {
  it('renames isPreviewRequest to hasPreviewIntent only when the package is imported', () => {
    const src =
      "import { isPreviewRequest } from 'payload-live-preview';\nif (isPreviewRequest(req)) {}\n";
    const { output, edits } = migrateSource(src, { only: ['rename-is-preview-request'] });
    expect(output).toBe(
      "import { hasPreviewIntent } from 'payload-live-preview';\nif (hasPreviewIntent(req)) {}\n",
    );
    expect(edits.map((e) => e.codemod)).toEqual(['rename-is-preview-request']);
  });

  it("leaves a consumer's own isPreviewRequest alone when nothing is imported from the package", () => {
    const src = 'function isPreviewRequest(r) { return false; }\nisPreviewRequest(req);\n';
    expect(migrateSource(src).output).toBe(src);
  });

  it('does not rewrite a property access named isPreviewRequest', () => {
    const src = "import { hasPreviewIntent } from 'payload-live-preview';\nx.isPreviewRequest();\n";
    expect(migrateSource(src, { only: ['rename-is-preview-request'] }).output).toBe(src);
  });

  it('renames the createPreviewBindings authorized option to authorization', () => {
    const src =
      "import { createPreviewBindings } from 'payload-live-preview';\nconst b = createPreviewBindings({ authorized: true });\n";
    const { output } = migrateSource(src, { only: ['rename-bindings-authorized-option'] });
    expect(output).toContain('createPreviewBindings({ authorization: true })');
  });

  it('does not touch an authorized key outside a createPreviewBindings call', () => {
    const src =
      "import { initLivePreview } from 'payload-live-preview';\nconst opts = { authorized: true };\n";
    expect(migrateSource(src, { only: ['rename-bindings-authorized-option'] }).output).toBe(src);
  });

  it('moves the fetch helpers to definePreview on the server subpath, keeping other imports', () => {
    const src =
      "import { initLivePreview, fetchPreviewDocument } from 'payload-live-preview';\nawait fetchPreviewDocument(x);\n";
    const { output } = migrateSource(src, { only: ['move-fetch-preview-helpers'] });
    expect(output).toContain("import { initLivePreview } from 'payload-live-preview';");
    expect(output).toContain("import { definePreview } from 'payload-live-preview/server';");
  });

  it('is idempotent: a second pass changes nothing', () => {
    const src =
      "import { isPreviewRequest, fetchPreviewGlobal } from 'payload-live-preview';\nisPreviewRequest(r); fetchPreviewGlobal(g);\n";
    const once = migrateSource(src).output;
    expect(migrateSource(once).output).toBe(once);
  });

  it('skips the rename and reports a conflict when the module already binds hasPreviewIntent', () => {
    const src =
      "import { isPreviewRequest } from 'payload-live-preview';\n" +
      'export function hasPreviewIntent(r) { return isPreviewRequest(r, { signals: ["query"] }); }\n';
    const { output, edits, conflicts } = migrateSource(src, {
      only: ['rename-is-preview-request'],
    });
    expect(output).toBe(src); // unchanged — renaming would collide with the local wrapper
    expect(edits).toEqual([]);
    expect(conflicts.map((c) => c.codemod)).toEqual(['rename-is-preview-request']);
  });

  it('every codemod maps to a real ledger entry (1–12)', () => {
    for (const codemod of CODEMODS) {
      expect(codemod.ledgerEntry).toBeGreaterThanOrEqual(1);
      expect(codemod.ledgerEntry).toBeLessThanOrEqual(12);
      expect(codemod.summary.length).toBeGreaterThan(10);
    }
  });
});
