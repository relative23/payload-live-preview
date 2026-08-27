import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer, RendererKey } from '@core/types';
import { buildBuiltinRenderers } from '@field-types/index';
import { lexicalToHtml, registerLexicalNode } from '@lexical/index';
import { sanitizeHtml } from '@security/sanitizer';

/**
 * The renderer API (roadmap 1.2.0): namespaced custom renderer keys that
 * cannot be typos of built-in types, an explicit resolver that sees the
 * element, a project rich-text renderer shared by SSR and preview, and the
 * sanitizer sitting deterministically behind custom Lexical nodes.
 */

class IO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const TRUSTED = 'https://admin.example.com';
let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'payload-live-preview', data }, origin: TRUSTED }),
  );
}

function afterUpdate(): Promise<void> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => {
      resolve();
    });
  });
}

function start(options: {
  renderers?: Record<string, FieldRenderer>;
  resolveRenderer?: (key: RendererKey, target: { element: Element }) => FieldRenderer | undefined;
  renderRichText?: (value: unknown) => string;
}): LivePreviewRuntime {
  const renderers = { ...buildBuiltinRenderers(), ...(options.renderers ?? {}) };
  runtime = new LivePreviewRuntime({
    renderers,
    ...(options.resolveRenderer !== undefined
      ? {
          resolveRenderer: (key: RendererKey, target: { element: Element }) =>
            options.resolveRenderer?.(key, target) ?? renderers[key],
        }
      : {}),
    ...(options.renderRichText !== undefined ? { renderRichText: options.renderRichText } : {}),
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
  });
  runtime.start();
  return runtime;
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('custom renderer keys', () => {
  it('selects a namespaced renderer by its exact key', async () => {
    document.body.innerHTML =
      '<span data-payload-field="price" data-payload-type="acme:money">0</span>';
    const money: FieldRenderer = {
      name: 'acme:money',
      render: (target, value) => {
        target.element.textContent = `€ ${String(value)}`;
      },
    };
    start({ renderers: { 'acme:money': money } });
    const done = afterUpdate();
    post({ price: 12 });
    await done;
    expect(document.querySelector('[data-payload-field="price"]')?.textContent).toBe('€ 12');
    expect(runtime?.inspect().bindings.elements).toBe(1);
  });

  it('still treats an un-namespaced unknown type as a typo and falls back to the heuristics', async () => {
    document.body.innerHTML = '<p data-payload-field="title" data-payload-type="richtext">old</p>';
    start({});
    const done = afterUpdate();
    post({ title: 'plain text' });
    await done;
    // `richtext` is not a built-in key (it is `richText`) and not namespaced:
    // the element renders as text, exactly as before custom keys existed.
    expect(document.querySelector('[data-payload-field="title"]')?.textContent).toBe('plain text');
  });
});

describe('explicit renderer resolver', () => {
  it('runs ahead of the registry with the element in hand, and falls through when it returns nothing', async () => {
    document.body.innerHTML =
      '<p data-payload-field="a" data-role="shout">a</p><p data-payload-field="b">b</p>';
    const shout: FieldRenderer = {
      name: 'text',
      render: (target, value) => {
        target.element.textContent = String(value).toUpperCase();
      },
    };
    const resolver = vi.fn((key: RendererKey, target: { element: Element }) =>
      key === 'text' && target.element.getAttribute('data-role') === 'shout' ? shout : undefined,
    );
    start({ resolveRenderer: resolver });
    const done = afterUpdate();
    post({ a: 'loud', b: 'quiet' });
    await done;
    expect(document.querySelector('[data-payload-field="a"]')?.textContent).toBe('LOUD');
    expect(document.querySelector('[data-payload-field="b"]')?.textContent).toBe('quiet');
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

const DOC = {
  root: {
    type: 'root',
    children: [
      { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Some ' },
          { type: 'text', text: 'bold', format: 1 },
          { type: 'callout', tone: 'info', children: [{ type: 'text', text: 'note' }] },
        ],
      },
    ],
  },
};

describe('renderRichText — one renderer for SSR and preview', () => {
  it('produces the same markup on the server and in the runtime for one Lexical document', async () => {
    // The project's renderer: the built-in Lexical renderer plus a custom node.
    registerLexicalNode('callout', (node, context) => {
      const tone = typeof node['tone'] === 'string' ? node['tone'] : 'note';
      return `<aside class="callout ${tone}">${context.renderChildren(
        (node.children as never[] | undefined) ?? [],
      )}</aside>`;
    });
    const renderRichText = (value: unknown): string =>
      lexicalToHtml(value as Parameters<typeof lexicalToHtml>[0]);

    // SSR side: what the page would have rendered — sanitized the same way.
    const ssr = sanitizeHtml(renderRichText(DOC));

    // Preview side: the runtime renders the same document into the element.
    document.body.innerHTML = '<div data-payload-field="body" data-payload-richtext>stale</div>';
    start({ renderRichText });
    const done = afterUpdate();
    post({ body: DOC });
    await done;
    const preview = document.querySelector('[data-payload-field="body"]')?.innerHTML ?? '';

    expect(preview).toBe(ssr);
    expect(preview).toContain('<aside class="callout info">note</aside>');
    expect(preview).toContain('<strong>bold</strong>');
  });

  it('sanitizes what the project renderer returns', async () => {
    document.body.innerHTML = '<div data-payload-field="body" data-payload-richtext>stale</div>';
    start({ renderRichText: () => '<p onclick="steal()">x</p><script>alert(1)</script>' });
    const done = afterUpdate();
    post({ body: { root: { type: 'root', children: [] } } });
    await done;
    const html = document.querySelector('[data-payload-field="body"]')?.innerHTML ?? '';
    expect(html).toBe('<p>x</p>');
  });
});

describe('custom Lexical nodes and the sanitizer', () => {
  it('strips executable output of a custom node in the runtime path, whatever the node returned', async () => {
    registerLexicalNode(
      'widget',
      () => '<div onmouseover="x()"><script>alert(1)</script>safe</div>',
    );
    document.body.innerHTML = '<div data-payload-field="body" data-payload-richtext>stale</div>';
    start({});
    const done = afterUpdate();
    post({ body: { root: { type: 'root', children: [{ type: 'widget' }] } } });
    await done;
    const html = document.querySelector('[data-payload-field="body"]')?.innerHTML ?? '';
    expect(html).toBe('<div>safe</div>');
  });
});
