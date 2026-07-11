/**
 * Renderer for Lexical `relationship` nodes — inline references to
 * documents in other collections.
 *
 * We do not know how the consumer wants to render relationships, so
 * we emit a semantic `<a>` (or `<span>` when no URL field is present)
 * and tag it with `data-relation-to` so consumers can post-process.
 *
 * @module @lexical/nodes/relationship
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isSafeUrl } from '@security/url-validator';
import { register, type NodeRenderer } from '../registry';

interface RelationshipValue {
  readonly title?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly id?: string | number;
  readonly url?: string;
}

const relationshipRenderer: NodeRenderer = (node): string => {
  const relationTo = typeof node['relationTo'] === 'string' ? node['relationTo'] : '';
  const value = readValue(node);
  const label = pickLabel(value, relationTo);
  const safeLabel = escapeHtml(label);
  const relAttr = relationTo === '' ? '' : ` data-relation-to="${escapeHtml(relationTo)}"`;

  const url = value?.url;
  if (typeof url === 'string' && isSafeUrl(url)) {
    return `<a href="${escapeHtmlAttribute(url)}"${relAttr}>${safeLabel}</a>`;
  }
  return `<span${relAttr}>${safeLabel}</span>`;
};

register('relationship', relationshipRenderer);

export { relationshipRenderer };

function readValue(node: Record<string, unknown>): RelationshipValue | undefined {
  const raw = node['value'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  return raw;
}

function pickLabel(value: RelationshipValue | undefined, relationTo: string): string {
  if (value === undefined) return relationTo === '' ? '#' : `#${relationTo}`;
  if (typeof value.title === 'string' && value.title.length > 0) return value.title;
  if (typeof value.name === 'string' && value.name.length > 0) return value.name;
  if (typeof value.slug === 'string' && value.slug.length > 0) return value.slug;
  if (value.id !== undefined) return String(value.id);
  return relationTo === '' ? '#' : `#${relationTo}`;
}
