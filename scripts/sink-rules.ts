/**
 * The site-level half of the capability gate: every HTML sink and every
 * attribute write that could carry a URL or a style is held to the reviewed
 * inventory in `sink-inventory.ts`. The module-level rules in
 * `architecture-rules.ts` say which modules may hold a sink at all; these say
 * that each site is the one that was reviewed, is fed what the review says,
 * and that no review outlives its site.
 */

import type { ArchitectureModule } from './architecture-graph';
import type { ArchitectureViolation } from './architecture-rules';
import {
  ATTRIBUTE_SINKS,
  HTML_SINKS,
  sinkKey,
  type AttributeSinkJustification,
  type HtmlSinkJustification,
} from './sink-inventory';

export interface SinkInventory {
  readonly html: ReadonlyMap<string, HtmlSinkJustification>;
  readonly attribute: ReadonlyMap<string, AttributeSinkJustification>;
}

export const SINK_INVENTORY: SinkInventory = { html: HTML_SINKS, attribute: ATTRIBUTE_SINKS };

/** Attributes whose value the browser will fetch, navigate to, or apply as CSS. */
const URL_BEARING_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'srcset',
  'poster',
  'cite',
  'action',
  'xlink:href',
  'data',
  'style',
]);

/** Never written by name, whatever the value: a handler, a document, a form target. */
const FORBIDDEN_ATTRIBUTES: ReadonlySet<string> = new Set(['srcdoc', 'formaction']);

const NEEDS_REVIEW_WHEN_COMPUTED: ReadonlySet<AttributeSinkJustification> = new Set([
  'gated',
  'copied',
  'binding-stamp',
]);
const NEEDS_REVIEW_WHEN_URL_BEARING: ReadonlySet<AttributeSinkJustification> = new Set([
  'url-validated',
  'constant',
]);

/** What each justification requires the source to show, beyond the listing itself. */
const EVIDENCE: Readonly<Record<string, { readonly pattern: RegExp; readonly missing: string }>> = {
  'inert-parse': {
    pattern: /createElement\('template'\)/u,
    missing: 'must parse into a <template>, not a live element',
  },
  'trusted-origin': {
    pattern: /createElement\('template'\)/u,
    missing: 'must parse into a <template>, not a live element',
  },
  'url-validated': {
    pattern: /\b(?:isSafeUrl|acceptUrl)\b/u,
    missing: 'must check the URL with isSafeUrl or acceptUrl in the same module',
  },
};

export function findSinkViolations(
  modules: readonly ArchitectureModule[],
  inventory: SinkInventory,
  sourceOf: (path: string) => string,
): readonly ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const report = (module: string, message: string): void => {
    violations.push({ kind: 'capability', module, message });
  };
  const live = new Set<string>();

  for (const module of modules) {
    for (const use of module.capabilities) {
      const key = sinkKey(module.path, use.site);
      if (use.kind === 'html-sink') {
        live.add(key);
        if (!use.site.startsWith('trustedHtml(')) {
          report(
            module.path,
            `${key} writes markup without trustedHtml(); the page would break under a Trusted Types CSP`,
          );
        }
        const justification = inventory.html.get(key);
        if (justification === undefined) {
          report(module.path, `${key} is an HTML sink the inventory does not list`);
          continue;
        }
        const evidence = EVIDENCE[justification];
        if (evidence !== undefined && !evidence.pattern.test(sourceOf(module.path))) {
          report(module.path, `${key} is reviewed as ${justification} and ${evidence.missing}`);
        }
        continue;
      }
      if (use.kind !== 'attribute-sink') continue;
      const name = use.attribute?.toLowerCase();
      if (name !== undefined && (name.startsWith('on') || FORBIDDEN_ATTRIBUTES.has(name))) {
        report(module.path, `${key} writes ${name}, which nothing in this package may write`);
        continue;
      }
      const computed = name === undefined;
      if (!computed && !URL_BEARING_ATTRIBUTES.has(name)) continue;
      live.add(key);
      const justification = inventory.attribute.get(key);
      if (justification === undefined) {
        report(
          module.path,
          computed
            ? `${key} computes the attribute it writes and the inventory does not list it`
            : `${key} writes ${name} and the inventory does not list it`,
        );
        continue;
      }
      const allowed = computed ? NEEDS_REVIEW_WHEN_COMPUTED : NEEDS_REVIEW_WHEN_URL_BEARING;
      if (!allowed.has(justification)) {
        report(
          module.path,
          `${key} is reviewed as ${justification}, which does not cover ${computed ? 'a computed name' : name}`,
        );
        continue;
      }
      const evidence = EVIDENCE[justification];
      if (evidence !== undefined && !evidence.pattern.test(sourceOf(module.path))) {
        report(module.path, `${key} is reviewed as ${justification} and ${evidence.missing}`);
      }
    }
  }

  for (const key of [...inventory.html.keys(), ...inventory.attribute.keys()]) {
    if (!live.has(key)) {
      report(key.slice(0, key.indexOf('::')), `${key} is reviewed but no longer exists as written`);
    }
  }
  return violations.sort((left, right) => left.message.localeCompare(right.message));
}
