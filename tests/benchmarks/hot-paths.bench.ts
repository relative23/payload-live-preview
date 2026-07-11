/**
 * Benchmarks for the runtime's hot paths.
 *
 * Run with `npm run test:bench`. Numbers land in docs/benchmarks.md —
 * refresh them when touching the cache, sanitizer, or Lexical
 * renderer. jsdom is not a browser: treat results as relative
 * regression signals, not absolute browser timings.
 */
import { bench, describe } from 'vitest';
import { ElementCache } from '@core/cache';
import { resolveFieldValue } from '@core/lifecycle';
import { sanitizeHtml } from '@security/sanitizer';
import { escapeHtml } from '@security/escape';
import { lexicalToHtml } from '@lexical/render';
import type { LexicalRoot } from '@lexical/types';
import { diffArray } from '@schema/diff';

function buildDom(fieldCount: number): void {
  const parts: string[] = [];
  for (let i = 0; i < fieldCount; i += 1) {
    parts.push(`<section><h2 data-payload-field="title_${String(i)}">t</h2>
      <p data-payload-field="body_${String(i)}" data-payload-richtext>b</p>
      <img data-payload-field="img_${String(i)}" src="/x.jpg" alt="">
    </section>`);
  }
  document.body.innerHTML = parts.join('');
}

describe('element cache', () => {
  bench('buildFromRoot — 300 bound elements', () => {
    buildDom(100); // 3 bindings per section
    const cache = new ElementCache();
    cache.buildFromRoot(document);
  });
});

describe('field resolution', () => {
  const fields = {
    hero: { media: { sizes: { large: { url: '/img.jpg', width: 1200 } } } },
    title: 'x',
  };
  bench('resolveFieldValue — 4-level nested path', () => {
    resolveFieldValue(fields, 'hero.media.sizes.large.url', undefined);
  });
});

describe('sanitizer', () => {
  const html =
    '<article>' +
    '<h2 class="x">Heading</h2>' +
    '<p>Some <strong>bold</strong> and <a href="https://example.com" target="_blank">a link</a>.</p>'.repeat(
      20,
    ) +
    '<img src="/a.jpg" srcset="/a.jpg 1x, /b.jpg 2x" alt="i">' +
    '<script>alert(1)</script><div onclick="x()">strip me</div>' +
    '</article>';
  bench('sanitizeHtml — ~2 KB mixed document', () => {
    sanitizeHtml(html);
  });
});

describe('escaping', () => {
  const text = 'Text with <tags> & "quotes" repeated '.repeat(50);
  bench('escapeHtml — ~2 KB string', () => {
    escapeHtml(text);
  });
});

describe('lexical renderer', () => {
  const doc: LexicalRoot = {
    root: {
      type: 'root',
      children: Array.from({ length: 30 }, (_, i) => ({
        type: 'paragraph',
        children: [
          { type: 'text', text: `Paragraph ${String(i)} with `, format: 0 },
          { type: 'text', text: 'bold', format: 1 },
          {
            type: 'link',
            fields: { url: 'https://example.com' },
            children: [{ type: 'text', text: ' and a link' }],
          },
        ],
      })),
    },
  };
  bench('lexicalToHtml — 30 paragraphs with links', () => {
    lexicalToHtml(doc);
  });
});

describe('structural diff', () => {
  const before = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `item ${String(i)}` }));
  const after = [
    ...before.slice(0, 40),
    { id: 999, label: 'inserted' },
    ...before.slice(40, 90),
    ...before.slice(91).reverse(),
  ];
  bench('diffArray — 100 items, insert + remove + moves', () => {
    diffArray(before, after);
  });
});
