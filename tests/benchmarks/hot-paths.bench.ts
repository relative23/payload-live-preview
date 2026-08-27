/**
 * Benchmarks for the runtime's hot paths.
 *
 * Run with `npm run test:bench`. Numbers land in docs/benchmarks.md —
 * refresh them when touching the cache, lifecycle, sanitizer, or Lexical
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
import { applyStructuralPatches, createStructuralStore } from '@core/structural-applier';
import { EventEmitter } from '@events/emitter';

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

function buildFlatDom(bindingCount: number): void {
  const parts: string[] = [];
  for (let index = 0; index < bindingCount; index += 1) {
    parts.push(`<span data-payload-field="field_${String(index)}">value</span>`);
  }
  document.body.innerHTML = parts.join('');
}

describe('element cache', () => {
  bench('buildFromRoot — 300 bound elements', () => {
    buildDom(100); // 3 bindings per section
    const cache = new ElementCache();
    cache.buildFromRoot(document);
  });

  bench('buildFromRoot — 1,000 flat bindings', () => {
    buildFlatDom(1_000);
    const cache = new ElementCache();
    cache.buildFromRoot(document);
  });

  bench('buildFromRoot — 5,000 flat bindings', () => {
    buildFlatDom(5_000);
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

describe('empty lifecycle event path', () => {
  const emitter = new EventEmitter();
  const elements = Array.from({ length: 300 }, () => document.createElement('span'));

  bench('skip elementUpdate snapshot/dispatch — 300 bindings, no listeners', () => {
    for (const element of elements) {
      // Mirrors the runtime fast path: the payload, DOM snapshot, eligibility
      // closure, and Promise are created only for an observed event channel.
      if (emitter.listenerCount('elementUpdate') === 0) continue;
      void emitter.emitWhile(
        'elementUpdate',
        {
          element,
          fieldName: 'title',
          previousValue: element.textContent,
          nextValue: 'next',
          revision: 1,
        },
        () => true,
      );
    }
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

/**
 * ADR 0008 §6: the morph replaces `replaceWith()` only if it is not slower
 * on the cases that matter — one changed item in a 100-item list, and a
 * full reorder. Both modes run on identical DOM so the ratio is the signal.
 */
describe('structural apply — morph versus replace (ADR 0008)', () => {
  const TEMPLATE = '<li class="row"><span class="t">{{title}}</span><em>{{index}}</em></li>';
  const POOL = 80;
  const items = (offset: number): readonly Record<string, unknown>[] =>
    Array.from({ length: 100 }, (_, i) => ({
      id: `k${String(i)}`,
      title: `Title ${String(i + offset)}`,
    }));
  const base = items(0);
  const oneChanged = base.map((item, i) => (i === 50 ? { ...item, title: 'changed' } : item));
  const reordered = [...base.slice(50), ...base.slice(0, 50)];

  interface Seeded {
    readonly container: Element;
    readonly store: ReturnType<typeof createStructuralStore>;
  }
  // Seeding is the expensive part and not what is measured: a pool of
  // pre-seeded containers is prepared once per bench and each iteration
  // consumes one, so the sample is the update alone.
  function seedPool(): Seeded[] {
    document.body.innerHTML = '';
    const pool: Seeded[] = [];
    for (let n = 0; n < POOL; n += 1) {
      const container = document.createElement('ul');
      document.body.append(container);
      const store = createStructuralStore();
      applyStructuralPatches({
        template: TEMPLATE,
        container,
        patches: diffArray([], base),
        nextItems: base,
        store,
        forceRender: true,
      });
      pool.push({ container, store });
    }
    return pool;
  }

  function scenario(morph: boolean, next: readonly Record<string, unknown>[]): void {
    let pool: Seeded[] = [];
    let cursor = 0;
    bench(
      `${next === reordered ? '100 items reordered' : 'one of 100 items changed'} — ${morph ? 'morph' : 'replace'}`,
      () => {
        const seeded = pool[cursor] ?? pool[0];
        cursor = (cursor + 1) % pool.length;
        if (seeded === undefined) return;
        applyStructuralPatches({
          template: TEMPLATE,
          container: seeded.container,
          patches: diffArray(base, next),
          nextItems: next,
          store: seeded.store,
          morph,
        });
      },
      {
        setup: () => {
          pool = seedPool();
          cursor = 0;
        },
        iterations: POOL,
        warmupIterations: 0,
      },
    );
  }

  scenario(true, oneChanged);
  scenario(false, oneChanged);
  scenario(true, reordered);
  scenario(false, reordered);
});
