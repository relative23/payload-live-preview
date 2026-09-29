/**
 * ADR 0024: the setups that serialize their options (Astro's integration in
 * middleware mode, the Nuxt module) take `authorizePreview` by module
 * reference. Both write the same lines into the source they generate: the
 * import, and a check that names the reference when it is not a hook.
 */

/** The option's text in every message, so a reader can search for it. */
const OPTION = 'authorizePreviewModule';

/** A reference outside the project is refused: the hook is this project's server code. */
export function refuseOutsideReference(reference: string): void {
  if (reference.startsWith('../') || reference.startsWith('..\\')) {
    throw new Error(
      `payload-live-preview: ${OPTION} "${reference}" is outside the project; ` +
        'name a module inside it, relative to the project root (ADR 0024).',
    );
  }
}

/** Written into generated source: `<` escaped as the serialized options are. */
function literal(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003C');
}

/** The import of the hook and the check that it is one, as generated source lines. */
export function hookImportLines(specifier: string): string[] {
  const message =
    `payload-live-preview: ${OPTION} "${specifier}" must export the authorizePreview ` +
    'hook as its default export (ADR 0024).';
  return [
    `import authorizePreview from ${literal(specifier)};`,
    `if (typeof authorizePreview !== "function") throw new Error(${literal(message)});`,
  ];
}
