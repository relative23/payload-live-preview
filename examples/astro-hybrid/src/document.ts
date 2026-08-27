import {
  isLexicalContent,
  lexicalToHtml,
  lexicalToPlainText,
  registerLexicalNode,
} from 'payload-live-preview/lexical';

// A custom Lexical node the site defines: rendered by the server inside the
// fragment, which is exactly what patching cannot do for an unknown node.
registerLexicalNode('callout', (node) => {
  const text = typeof node['text'] === 'string' ? node['text'] : '';
  return `<aside class="callout" data-testid="callout">${text}</aside>`;
});

/** The document the fixture renders; the admin's unsaved state overrides it. */
export interface HeroDocument {
  readonly title: string;
  readonly subtitle?: string;
  /** A populated relationship, as Payload 3.x's REST merge delivers it. */
  readonly author?: { readonly name: string };
  /** A populated upload. */
  readonly image?: { readonly url: string; readonly alt: string };
  /** Access control: rendered only for an authorized subject. */
  readonly editorTools: boolean;
  readonly locale?: string;
  /** Plain text, or a Lexical root the server renders. */
  readonly body: unknown;
  readonly bodyHtml: string;
  readonly words: number;
  readonly blocks: readonly {
    readonly id: string;
    readonly kind: 'quote' | 'note';
    readonly text: string;
  }[];
}

function renderBody(body: unknown): { bodyHtml: string; words: number } {
  const text = isLexicalContent(body)
    ? lexicalToPlainText(body)
    : typeof body === 'string'
      ? body
      : '';
  const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
  const bodyHtml = isLexicalContent(body) ? lexicalToHtml(body) : `<p>${escapeText(text)}</p>`;
  return { bodyHtml, words };
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const initialDocument: HeroDocument = {
  title: 'Hybrid preview',
  body: 'Three words here',
  ...renderBody('Three words here'),
  author: { name: 'Ada Lovelace' },
  image: { url: '/media/hero.png', alt: 'Hero image' },
  editorTools: false,
  blocks: [{ id: 'b1', kind: 'note', text: 'A note block' }],
};

export interface HeroContext {
  readonly locale?: string;
  /** Whether the request is an authorized preview with a subject. */
  readonly editor: boolean;
}

function relationship(value: unknown, fallback: { readonly name: string } | undefined) {
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  ) {
    return { name: (value as { name: string }).name };
  }
  return fallback;
}

function upload(
  value: unknown,
  fallback: { readonly url: string; readonly alt: string } | undefined,
) {
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { url?: unknown }).url === 'string'
  ) {
    const v = value as { url: string; alt?: unknown };
    return { url: v.url, alt: typeof v.alt === 'string' ? v.alt : '' };
  }
  return fallback;
}

export function heroProps(
  fields: Readonly<Record<string, unknown>>,
  context: HeroContext = { editor: false },
): HeroDocument {
  const blocks = Array.isArray(fields['blocks'])
    ? fields['blocks']
        .filter(
          (b): b is { id: string; kind: 'quote' | 'note'; text: string } =>
            typeof b === 'object' &&
            b !== null &&
            typeof (b as { text?: unknown }).text === 'string',
        )
        .map((b, index) => ({
          id: b.id ?? String(index),
          kind: b.kind === 'quote' ? 'quote' : 'note',
          text: b.text,
        }))
    : initialDocument.blocks;
  const body = fields['body'] === undefined ? initialDocument.body : fields['body'];
  return {
    title: typeof fields['title'] === 'string' ? fields['title'] : initialDocument.title,
    subtitle:
      typeof fields['subtitle'] === 'string' && fields['subtitle'].length > 0
        ? fields['subtitle']
        : undefined,
    author: relationship(fields['author'], initialDocument.author),
    image: upload(fields['image'], initialDocument.image),
    editorTools: context.editor,
    ...(context.locale !== undefined ? { locale: context.locale } : {}),
    body,
    ...renderBody(body),
    blocks,
  };
}
