/**
 * Codemods for the 1.x → 2.0 renames and moves (roadmap 1.9.0; ADR 0007 is
 * the ledger this mirrors). Each codemod is a pure source-to-source
 * transform with a stable id, applied by `migrateSource()`; `runMigrate()`
 * walks files and reports or writes the edits. Text-based on purpose: it
 * runs without a TypeScript program, so a consumer can migrate a mixed
 * repo (`.ts`, `.astro`, `.svelte`, `.vue`, `.mjs`) with no build step.
 *
 * A codemod only ever touches this package's own API surface — imports from
 * `payload-live-preview*` and the names those imports bind — so it cannot
 * rewrite an unrelated `isPreviewRequest` of the consumer's own.
 *
 * @module payload-live-preview/migrate
 */

/** One rewrite a codemod made, for the report. */
export interface CodemodEdit {
  readonly codemod: string;
  readonly before: string;
  readonly after: string;
}

export interface Codemod {
  /** Stable id, e.g. `rename-is-preview-request` (ADR 0007 entry). */
  readonly id: string;
  /** One line: what it changes and to what. */
  readonly summary: string;
  /** The ledger entry it implements. */
  readonly ledgerEntry: number;
  /** Rewrite the source; return the same string when nothing matched. */
  readonly apply: (source: string) => string;
}

const PACKAGE = 'payload-live-preview';

/** Whether the source imports anything from this package (any subpath). */
export function importsThisPackage(source: string): boolean {
  return new RegExp(`from\\s*['"]${PACKAGE}(?:/[a-z-/.]+)?['"]`, 'u').test(source);
}

/** Replace `name(` call sites, and the name in an import list, with `replacement`. */
function renameIdentifier(source: string, name: string, replacement: string): string {
  const wordBoundary = new RegExp(`(?<![\\w.])${name}(?![\\w])`, 'gu');
  return source.replace(wordBoundary, replacement);
}

/**
 * Whether the module already binds `name` as its own declaration or import —
 * a function, const/let/var, class, or a named import. A rename into a name
 * the module already uses would collide (or, for a same-named wrapper, recurse),
 * so a codemod that would do that must skip the file and report it instead.
 */
function alreadyBinds(source: string, name: string): boolean {
  const decl = new RegExp(
    `(?:function|const|let|var|class)\\s+${name}\\b|\\b${name}\\s+as\\b|\\bas\\s+${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`,
    'u',
  );
  return decl.test(source);
}

/**
 * The codemods, in the order they should run. Each is idempotent: applying it
 * twice is the same as applying it once.
 */
export const CODEMODS: readonly Codemod[] = [
  {
    id: 'rename-is-preview-request',
    summary: '`isPreviewRequest()` → `hasPreviewIntent()` (same signature)',
    ledgerEntry: 1,
    apply: (source) => {
      if (!importsThisPackage(source) || !/\bisPreviewRequest\b/u.test(source)) return source;
      // The module already has a `hasPreviewIntent` of its own (commonly a
      // wrapper around the import). Renaming into it would collide or recurse,
      // so leave the file for a human — the runner reports it as a conflict.
      if (alreadyBinds(source, 'hasPreviewIntent')) return source;
      return renameIdentifier(source, 'isPreviewRequest', 'hasPreviewIntent');
    },
  },
  {
    id: 'rename-bindings-authorized-option',
    summary: '`createPreviewBindings({ authorized })` → `{ authorization }`',
    ledgerEntry: 7,
    apply: (source) => {
      if (!importsThisPackage(source)) return source;
      // Only inside a createPreviewBindings(...) call, and only the option key.
      return source.replace(
        /(createPreviewBindings\s*\(\s*\{[^}]*?)\bauthorized\b(\s*:)/gu,
        '$1authorization$2',
      );
    },
  },
  {
    id: 'move-fetch-preview-helpers',
    summary:
      '`fetchPreviewDocument`/`fetchPreviewGlobal` from the root → `definePreview().fetchDocument`/`.fetchGlobal` (payload-live-preview/server)',
    ledgerEntry: 9,
    apply: (source) => {
      if (!importsThisPackage(source)) return source;
      let next = source;
      // The import specifiers become definePreview from the server subpath.
      next = next.replace(
        /import\s*\{([^}]*)\}\s*from\s*['"]payload-live-preview['"]/gu,
        (match, names: string) => {
          if (!/fetchPreview(Document|Global)/u.test(names)) return match;
          const kept = names
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0 && !/^fetchPreview(Document|Global)$/u.test(part));
          const rewritten =
            kept.length > 0 ? `import { ${kept.join(', ')} } from 'payload-live-preview';\n` : '';
          return `${rewritten}import { definePreview } from 'payload-live-preview/server'`;
        },
      );
      return next;
    },
  },
];

/** A removed API a codemod could not rewrite automatically, and why. */
export interface CodemodConflict {
  readonly codemod: string;
  readonly reason: string;
}

/** Removed names a codemod could not rewrite because the module already binds the target. */
function conflictsIn(source: string): CodemodConflict[] {
  const conflicts: CodemodConflict[] = [];
  if (
    importsThisPackage(source) &&
    /\bisPreviewRequest\b/u.test(source) &&
    alreadyBinds(source, 'hasPreviewIntent')
  ) {
    conflicts.push({
      codemod: 'rename-is-preview-request',
      reason:
        'isPreviewRequest was removed but this module already binds hasPreviewIntent; ' +
        'rename your local hasPreviewIntent (or drop the wrapper and import the package’s directly).',
    });
  }
  return conflicts;
}

/** Apply every codemod (or a chosen subset) to one source string. */
export function migrateSource(
  source: string,
  options: { readonly only?: readonly string[] } = {},
): {
  readonly output: string;
  readonly edits: readonly CodemodEdit[];
  readonly conflicts: readonly CodemodConflict[];
} {
  const chosen =
    options.only === undefined ? CODEMODS : CODEMODS.filter((c) => options.only?.includes(c.id));
  let output = source;
  const edits: CodemodEdit[] = [];
  for (const codemod of chosen) {
    const before = output;
    output = codemod.apply(output);
    if (output !== before) edits.push({ codemod: codemod.id, before, after: output });
  }
  return { output, edits, conflicts: conflictsIn(output) };
}
