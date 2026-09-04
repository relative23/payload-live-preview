/** `email` renderer: a bare address becomes a `mailto:` link, a value with a scheme is used as written. */

import type { FieldRenderer } from '@core/types';
import { createLinkRenderer } from './url';

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function mailtoHref(value: string): string {
  const trimmed = value.trim();
  if (HAS_SCHEME.test(trimmed) || !trimmed.includes('@')) return trimmed;
  return `mailto:${trimmed}`;
}

export const emailRenderer: FieldRenderer = createLinkRenderer('email', mailtoHref);
