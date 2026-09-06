/**
 * The document the boundary renders, and how unsaved form state becomes its
 * props. The page's first render and the fragment endpoint both go through
 * `heroProps`, so a server render and a fragment render agree by construction.
 */
export interface HeroDocument {
  readonly title: string;
  /** Rendered only when set — the section a patch cannot create. */
  readonly subtitle?: string;
  readonly body: string;
  /** Derived on the server: the component's own logic, not a field. */
  readonly words: number;
}

export const initialDocument = { title: 'Hybrid preview on SvelteKit', body: 'Three words here' };

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function heroProps(fields: Record<string, unknown>): HeroDocument {
  const title = text(fields['title'], initialDocument.title);
  const body = text(fields['body'], initialDocument.body);
  const subtitle = text(fields['subtitle'], '');
  // The fixture asks for a failing render this way, so the E2E can assert the
  // fallback: a boundary the server cannot render is patched instead.
  if (title.includes('boom')) throw new Error('the fixture was asked to fail this render');
  return {
    title,
    ...(subtitle.length > 0 ? { subtitle } : {}),
    body,
    words: body.trim().length === 0 ? 0 : body.trim().split(/\s+/u).length,
  };
}
