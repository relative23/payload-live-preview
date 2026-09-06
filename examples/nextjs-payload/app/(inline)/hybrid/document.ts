/**
 * The document the boundary renders, and how unsaved form state becomes its
 * props. Both the page's first render and the fragment endpoint go through
 * `heroProps`, so a server render and a fragment render agree by construction.
 */
export interface HeroDocument {
  readonly title: string;
  /** Rendered only when set — the section patching cannot create. */
  readonly subtitle?: string;
  readonly body: string;
  /** Derived on the server: the component's own logic, not a field. */
  readonly words: number;
}

export const initialDocument: HeroDocument = {
  title: 'Hybrid preview on Next.js',
  body: 'Three words here',
  words: 3,
};

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function heroProps(fields: Readonly<Record<string, unknown>>): HeroDocument {
  const title = text(fields['title'], initialDocument.title);
  const body = text(fields['body'], initialDocument.body);
  const subtitle = text(fields['subtitle'], '');
  // The fixture asks for a failing render this way, so the E2E can assert the
  // fallback: a boundary the server cannot render is patched from the same
  // revision instead of being left stale.
  if (title.includes('boom')) throw new Error('the fixture was asked to fail this render');
  return {
    title,
    ...(subtitle.length > 0 ? { subtitle } : {}),
    body,
    words: body.trim().length === 0 ? 0 : body.trim().split(/\s+/u).length,
  };
}
