import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetSanitizerWarningForTests, lexicalToHtml } from '@lexical/render';
import type { LexicalRoot } from '@lexical/types';

/**
 * `lexicalToHtml(content, { document })`: the SSR document named per call,
 * so a server that renders two requests at once never shares one through the
 * process-wide slot, and a server that never calls `setSanitizerDocument()`
 * still sanitises.
 */

const content: LexicalRoot = {
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'hello <b>there</b>' }],
      },
    ],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  __resetSanitizerWarningForTests();
});

describe('lexicalToHtml with a document per call', () => {
  it('sanitises with the given document and does not warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let created = 0;
    const doc = {
      createElement: (tag: string) => {
        created += 1;
        return document.createElement(tag) as unknown as {
          innerHTML: string;
          readonly content: ParentNode;
        };
      },
    };
    const html = lexicalToHtml(content, { document: doc });
    expect(html).toContain('<p>');
    expect(html).toContain('hello &lt;b&gt;there&lt;/b&gt;');
    // The renderer's markup is rewritten once, and parsed once more to confirm it settled.
    expect(created).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('sanitises with the given document under requireDocument too', () => {
    const doc = {
      createElement: (tag: string) =>
        document.createElement(tag) as unknown as {
          innerHTML: string;
          readonly content: ParentNode;
        },
    };
    expect(lexicalToHtml(content, { document: doc, requireDocument: true })).toContain(
      'hello &lt;b&gt;there&lt;/b&gt;',
    );
  });

  it('still skips sanitising when asked to', () => {
    let created = 0;
    const doc = {
      createElement: (tag: string) => {
        created += 1;
        return document.createElement(tag) as unknown as {
          innerHTML: string;
          readonly content: ParentNode;
        };
      },
    };
    lexicalToHtml(content, { document: doc, sanitize: false });
    expect(created).toBe(0);
  });
});
