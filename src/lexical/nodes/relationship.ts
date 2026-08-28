/** `relationship` renderer: a link when the populated document carries a URL, a span otherwise. */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isSafeUrl } from '@security/url-validator';
import type { NodeRenderer } from '../registry';
import { asRecord, pickRelationLabel, sanitizeIdent, type RelationShape } from '../value-shapes';

const relationshipRenderer: NodeRenderer = (node): string => {
  const relationTo = typeof node['relationTo'] === 'string' ? node['relationTo'] : '';
  const value = asRecord(node['value']) as RelationShape | undefined;
  const label = escapeHtml((value && pickRelationLabel(value)) ?? `#${relationTo}`);
  const slug = sanitizeIdent(relationTo);
  const classAttr =
    slug === '' ? ' class="lp-relation"' : ` class="lp-relation lp-relation--${slug}"`;
  const url = value?.url;
  if (typeof url === 'string' && isSafeUrl(url)) {
    return `<a href="${escapeHtmlAttribute(url)}"${classAttr}>${label}</a>`;
  }
  return `<span${classAttr}>${label}</span>`;
};

export { relationshipRenderer };
