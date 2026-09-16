/**
 * LP0409 — what the strict sanitizer removed that the 1.x default kept.
 *
 * `sanitizerPolicy` defaults to `'strict'` since 2.0; before that it was
 * `'compat'`, which let `id` and every `data-*` through, and `name` only where
 * a per-tag list allowed it. The difference
 * only shows when a binding *writes* markup, so a project that upgrades and
 * whose rich text carries its own hooks loses them at the moment an editor
 * types — silently, and in the preview only. Measured on a real consumer: a
 * `data-partner-scroll` attribute driving a CSS selector disappeared on the
 * first write, with nothing said anywhere.
 *
 * So it is said here: once per attribute name per page, with the reason that
 * applies to that name rather than one sentence covering three different
 * decisions. This is a report, never a behaviour — the attribute stays removed.
 */

/**
 * `console.warn` behind a try/catch rather than `@core/diagnostics`: `security`
 * is a leaf layer and may not import `core` (scripts/architecture-rules.ts), and
 * the shared helper's extra work — tolerating a logger that returns a thenable —
 * is for consumer-supplied loggers. This sink is fixed.
 */
function warn(message: string): void {
  try {
    console.warn(message);
  } catch {
    // A diagnostic must never become a second failure.
  }
}

const reported = new Set<string>();

/** The binding prefix, restated rather than imported: this module must not pull the applier in. */
const BINDING_PREFIX = 'data-payload-';

function reason(name: string): string {
  if (name.startsWith(BINDING_PREFIX)) {
    return (
      'A binding inside CMS content is refused by design — an editor could otherwise ' +
      'aim a write at any element on the page (docs/security.md)'
    );
  }
  if (name === 'id' || name === 'name') {
    return (
      'CMS content that can name an element can shadow a global of that name — ' +
      'DOM clobbering, refused by design (docs/security.md)'
    );
  }
  return (
    'List it in `allowedDataAttributes` if the page needs it, or set ' +
    "`sanitizerPolicy: 'compat'` to keep every `data-*` as 1.x did"
  );
}

/**
 * Report one removal. Only for attributes `'compat'` would have kept: everything
 * else the sanitizer drops was refused in 1.x too and is not news to anyone.
 */
export function reportDroppedAttribute(name: string): void {
  if (reported.has(name)) return;
  reported.add(name);
  warn(
    `[live-preview] LP0409: the strict sanitizer removed \`${name}\` from written markup; ` +
      `the 1.x default (\`sanitizerPolicy: 'compat'\`) kept it. ${reason(name)}.`,
  );
}

/** Test seam: the report is once per page, and a test is not a page. */
export function resetDroppedAttributeReports(): void {
  reported.clear();
}
