/**
 * The build profile: which features are compiled into the inline runtime.
 *
 * `scripts/build-runtime.ts` builds the runtime twice — once with everything,
 * once with `__LEAN_BUILD__` defined — and the generator embeds whichever the
 * page asked for. The flag is read into a constant so esbuild folds it and
 * drops the branch, and with it every module only that branch referenced. In
 * the programmatic client the define is absent, so nothing is dropped there.
 *
 * A profile is a byte trade, never a behaviour trade in disguise: a page that
 * needs what the lean profile left out is told so (LP0104) instead of quietly
 * doing nothing.
 *
 * The flag itself is not exported. Each guard site reads `__LEAN_BUILD__`
 * directly, in expression position, because that is the only shape esbuild
 * folds — `src/types/build-flags.d.ts` explains why, with what was measured.
 */

import { safeConsoleWarn } from './diagnostics';

/** What the lean profile leaves out, in the words the documentation uses. */
export type OmittedFeature =
  | 'structural arrays'
  | 'array templates'
  | 'server-rendered fragments'
  | 'route refreshes'
  | 'screen-reader announcements';

const HOW_TO_GET_IT: Readonly<Record<OmittedFeature, string>> = {
  'structural arrays': 'data-payload-type="array" and keyed lists',
  'array templates': 'data-payload-array-template',
  'server-rendered fragments': 'data-payload-fragment boundaries',
  'route refreshes': 'data-payload-strategy="route" and bindings in <head>',
  'screen-reader announcements': 'the aria-live region',
};

const reported = new Set<OmittedFeature>();

/**
 * Report once per feature and per page. The markup is the cause and it does not
 * change between updates, so a second message would only be noise.
 */
export function reportOmittedFeature(feature: OmittedFeature): void {
  if (reported.has(feature)) return;
  reported.add(feature);
  safeConsoleWarn(
    `[live-preview] LP0104: this page carries the lean runtime, which leaves out ${feature} ` +
      `(${HOW_TO_GET_IT[feature]}). The elements are left as the server rendered them. ` +
      `Remove \`profile: 'lean'\` to get the full runtime.`,
  );
}
