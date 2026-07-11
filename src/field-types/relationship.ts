/**
 * `relationship` field renderer.
 *
 * Renders the relation's `title` / `name` / `slug` / `id` (in that
 * order of preference). When the bound element is an `<a>` and the
 * value carries a `url`, the anchor's `href` is updated.
 *
 * Has-many relationships render the labels joined by ", ".
 *
 * @module @field-types/relationship
 */

import { isSafeUrl } from '@security/url-validator';
import type { FieldRenderer } from '@core/types';
import type { PayloadRelationship } from './types';
import { registerBuiltinRenderer } from './registry';
import { safeStringify } from './utils';

const relationshipRenderer: FieldRenderer = {
  name: 'relationship',
  render(target, value) {
    const element = target.element;
    const labels = collectLabels(value);
    const text = labels.join(', ');
    if (element.tagName === 'A' && !Array.isArray(value)) {
      const anchor = element as HTMLAnchorElement;
      const url = (value as PayloadRelationship | null)?.url;
      if (typeof url === 'string' && isSafeUrl(url)) anchor.href = url;
      anchor.textContent = text;
      return;
    }
    element.textContent = text;
  },
};

function collectLabels(value: unknown): readonly string[] {
  if (value === null || value === undefined) return [''];
  if (Array.isArray(value)) return value.map(pickLabel);
  return [pickLabel(value)];
}

function pickLabel(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const rel = value as PayloadRelationship;
    if (typeof rel.title === 'string' && rel.title.length > 0) return rel.title;
    if (typeof rel.name === 'string' && rel.name.length > 0) return rel.name;
    if (typeof rel.slug === 'string' && rel.slug.length > 0) return rel.slug;
    if (rel.id !== undefined) return String(rel.id);
    return '';
  }
  return safeStringify(value);
}

registerBuiltinRenderer(relationshipRenderer);

export { relationshipRenderer };
