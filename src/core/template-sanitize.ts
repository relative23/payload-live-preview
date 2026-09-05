/**
 * Sanitizer options for item templates (`data-payload-array-template`,
 * nested templates). A template is the page author's markup and every
 * interpolated value is escaped to text before the sanitizer runs, so it may
 * carry form controls and custom elements the rich-text policy refuses.
 * Event handlers, `style` and unsafe URLs are still stripped.
 *
 * Some entries below are already admitted by the sanitizer through another
 * route — `video` and `audio` by the tag allow-list, `select` by
 * `allowFormControls`, `name` by `templateMode`, and `controls`, `muted`,
 * `loop`, `poster` and `src` by the per-tag attribute map. They are kept
 * because this list states what a template may contain, and an allow-list
 * that depends on a second list staying unchanged is the more fragile of the
 * two arrangements. Mutating those entries changes nothing observable, so
 * they survive mutation testing by construction; the behaviour they describe
 * is pinned in `tests/unit/core/template-sanitize.test.ts` instead.
 */

import type { SanitizeOptions } from '@security/sanitizer';
import { lruGet, lruSet } from './lru';

const TEMPLATE_EXTRA_TAGS: readonly string[] = [
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'label',
  'details',
  'summary',
  'dialog',
  'video',
  'audio',
  'progress',
  'meter',
];

const TEMPLATE_EXTRA_ATTRIBUTES: readonly string[] = [
  'type',
  'name',
  'placeholder',
  'open',
  'disabled',
  'readonly',
  'required',
  'checked',
  'selected',
  'value',
  'min',
  'max',
  'step',
  'rows',
  'cols',
  'for',
  'controls',
  'muted',
  'loop',
  'poster',
  'src',
];

const CUSTOM_TAG_PATTERN = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/gi;

// 64 like the intl cache: more than a page declares, and a nested template is
// interpolated with its parent's, so an outer value or `{{index}}` that lands
// in it mints a key per item and per keystroke (ADR 0003 §3).
export const TEMPLATE_CACHE_LIMIT = 64;
const optionsByTemplate = new Map<string, SanitizeOptions>();

/** Options for one template; memoised per template string. */
export function templateSanitizeOptions(template: string): SanitizeOptions {
  const cached = lruGet(optionsByTemplate, template);
  if (cached !== undefined) return cached;
  const tags = new Set(TEMPLATE_EXTRA_TAGS);
  for (const match of template.matchAll(CUSTOM_TAG_PATTERN)) {
    const tag = match[1]?.toLowerCase();
    if (tag !== undefined) tags.add(tag);
  }
  const attributes: Record<string, readonly string[]> = {};
  for (const tag of tags) attributes[tag] = TEMPLATE_EXTRA_ATTRIBUTES;
  const options: SanitizeOptions = {
    additionalAllowedTags: [...tags],
    additionalAllowedAttributes: attributes,
    allowFormControls: true,
    templateMode: true,
  };
  return lruSet(optionsByTemplate, template, options, TEMPLATE_CACHE_LIMIT);
}
