import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lexicalToHtml } from '@lexical/render';
import {
  registerBlockRenderer,
  lookupBlockRenderer,
  registeredBlockTypes,
} from '@lexical/blocks/registry';
import { registerDefaultBlocks } from '@lexical/blocks/defaults';
import type { LexicalRoot } from '@lexical/types';

function makeBlockRoot(blockType: string, fields: Record<string, unknown>): LexicalRoot {
  return {
    root: {
      children: [{ type: 'block', fields: { blockType, ...fields } }],
    },
  };
}

describe('block registry — registration', () => {
  it('registerBlockRenderer + lookupBlockRenderer', () => {
    registerBlockRenderer('test-block-x', () => '<x></x>');
    expect(typeof lookupBlockRenderer('test-block-x')).toBe('function');
    expect(registeredBlockTypes()).toContain('test-block-x');
  });

  it('returns undefined for unregistered slugs', () => {
    expect(lookupBlockRenderer('definitely-not-registered-y')).toBeUndefined();
  });

  it('overwriting replaces the prior renderer', () => {
    registerBlockRenderer('test-overwrite', () => '<a></a>');
    registerBlockRenderer('test-overwrite', () => '<b></b>');
    const renderer = lookupBlockRenderer('test-overwrite');
    expect(
      renderer?.(
        {},
        {
          renderChildren: () => '',
        },
      ),
    ).toBe('<b></b>');
  });
});

describe('default block renderers (after registerDefaultBlocks)', () => {
  beforeEach(() => {
    registerDefaultBlocks();
  });

  afterEach(() => {
    // Defaults stay registered for the whole suite; tests must not
    // rely on a pristine state between them. The registry is process-
    // wide which mirrors production usage.
  });

  describe('callout', () => {
    it('renders an <aside> with default importance', () => {
      const html = lexicalToHtml(makeBlockRoot('callout', { text: 'Heads up' }), {
        sanitize: false,
      });
      expect(html).toContain('<aside class="lp-block-callout"');
      expect(html).toContain('data-importance="info"');
      expect(html).toContain('<p>Heads up</p>');
    });

    it('emits title as <strong> and respects custom importance', () => {
      const html = lexicalToHtml(
        makeBlockRoot('callout', { title: 'Warning', text: 'Body', importance: 'warning' }),
        { sanitize: false },
      );
      expect(html).toContain('<strong>Warning</strong>');
      expect(html).toContain('data-importance="warning"');
    });

    it('renders lexical body when present (delegates to renderChildren)', () => {
      const html = lexicalToHtml(
        makeBlockRoot('callout', {
          body: {
            root: {
              children: [{ type: 'paragraph', children: [{ type: 'text', text: 'rich' }] }],
            },
          },
        }),
        { sanitize: false },
      );
      expect(html).toContain('<p>rich</p>');
    });
  });

  describe('image block', () => {
    it('emits <figure><img> with alt + dimensions', () => {
      const html = lexicalToHtml(
        makeBlockRoot('image-block', {
          image: {
            url: 'https://cdn.example.com/a.jpg',
            alt: 'Cover',
            width: 1280,
            height: 720,
          },
          caption: 'A scene',
        }),
        { sanitize: false },
      );
      expect(html).toContain('<figure class="lp-block-image">');
      expect(html).toContain('src="https://cdn.example.com/a.jpg"');
      expect(html).toContain('alt="Cover"');
      expect(html).toContain('width="1280"');
      expect(html).toContain('height="720"');
      expect(html).toContain('<figcaption>A scene</figcaption>');
    });

    it('falls back to imageUrl + alt fields when no nested image object', () => {
      const html = lexicalToHtml(
        makeBlockRoot('imageBlock', {
          imageUrl: 'https://cdn.example.com/b.jpg',
          alt: 'Plain',
        }),
        { sanitize: false },
      );
      expect(html).toContain('src="https://cdn.example.com/b.jpg"');
      expect(html).toContain('alt="Plain"');
    });

    it('renders empty for unsafe URLs', () => {
      const html = lexicalToHtml(
        makeBlockRoot('image-block', { imageUrl: 'javascript:alert(1)' }),
        { sanitize: false },
      );
      expect(html).toBe('');
    });

    it('renders empty when no URL', () => {
      const html = lexicalToHtml(makeBlockRoot('image-block', {}), { sanitize: false });
      expect(html).toBe('');
    });
  });

  describe('video block', () => {
    it('emits <figure><video><source>', () => {
      const html = lexicalToHtml(
        makeBlockRoot('video-block', {
          video: { url: 'https://cdn.example.com/v.mp4', mimeType: 'video/mp4' },
          poster: 'https://cdn.example.com/p.jpg',
          caption: 'Demo reel',
        }),
        { sanitize: false },
      );
      expect(html).toContain('<figure class="lp-block-video">');
      expect(html).toContain('controls');
      expect(html).toContain('poster="https://cdn.example.com/p.jpg"');
      expect(html).toContain('<source src="https://cdn.example.com/v.mp4"');
      expect(html).toContain('type="video/mp4"');
      expect(html).toContain('<figcaption>Demo reel</figcaption>');
    });

    it('rejects unsafe video urls', () => {
      const html = lexicalToHtml(
        makeBlockRoot('video', { video: { url: 'javascript:alert(1)' } }),
        { sanitize: false },
      );
      expect(html).toBe('');
    });
  });

  describe('code block', () => {
    it('emits <pre><code class="language-…">', () => {
      const html = lexicalToHtml(
        makeBlockRoot('code-block', { code: 'console.log("hi")', language: 'js' }),
        { sanitize: false },
      );
      expect(html).toContain('<figure class="lp-block-code">');
      expect(html).toContain('<pre><code class="language-js">');
      expect(html).toContain('console.log');
    });

    it('escapes HTML in code content', () => {
      const html = lexicalToHtml(
        makeBlockRoot('codeBlock', { content: '<script>x</script>', language: 'html' }),
        { sanitize: false },
      );
      expect(html).not.toContain('<script>x</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('skips when code is missing', () => {
      const html = lexicalToHtml(makeBlockRoot('code-block', { language: 'js' }), {
        sanitize: false,
      });
      expect(html).toBe('');
    });
  });

  describe('cta block', () => {
    it('emits primary anchor and external rel attrs', () => {
      const html = lexicalToHtml(
        makeBlockRoot('cta-block', {
          label: 'Book now',
          href: 'https://booking.example.com',
        }),
        { sanitize: false },
      );
      expect(html).toContain('class="lp-block-cta__button lp-block-cta__button--primary"');
      expect(html).toContain('href="https://booking.example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('renders secondary button when both label + href are present', () => {
      const html = lexicalToHtml(
        makeBlockRoot('cta', {
          label: 'Primary',
          href: '/contact',
          secondaryLabel: 'Learn more',
          secondaryHref: '/about',
        }),
        { sanitize: false },
      );
      expect(html).toContain('lp-block-cta__button--secondary');
      expect(html).toContain('href="/about"');
    });

    it('includes optional lead text', () => {
      const html = lexicalToHtml(
        makeBlockRoot('cta-block', {
          label: 'Buy',
          href: '/buy',
          lead: 'Limited offer',
        }),
        { sanitize: false },
      );
      expect(html).toContain('<p class="lp-block-cta__lead">Limited offer</p>');
    });

    it('skips when label or href is missing', () => {
      const noLabel = lexicalToHtml(makeBlockRoot('cta-block', { href: '/x' }), {
        sanitize: false,
      });
      const noHref = lexicalToHtml(makeBlockRoot('cta-block', { label: 'L' }), {
        sanitize: false,
      });
      expect(noLabel).toBe('');
      expect(noHref).toBe('');
    });

    it('rejects unsafe href', () => {
      const html = lexicalToHtml(
        makeBlockRoot('cta-block', { label: 'X', href: 'javascript:alert(1)' }),
        { sanitize: false },
      );
      expect(html).toBe('');
    });
  });

  describe('fallback', () => {
    it('falls through to generic data-block-type for unknown slugs', () => {
      const html = lexicalToHtml(
        makeBlockRoot('totally-custom-slug', { text: 'x' }),
        { sanitize: false },
      );
      expect(html).toContain('data-block-type="totally-custom-slug"');
      expect(html).toContain('data-block-text="x"');
    });
  });
});
