/**
 * What `autoBind: 'unique'` binds, and how a guess is told apart from a
 * declaration (ADR 0014). The traps — what it must never bind — are in
 * `auto-bind-traps.test.ts`; this file is the other half.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { post, startRuntime, type RuntimeHarness } from '../../helpers/runtime';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

const TITLE = 'Hello from the demo';
const ISO = '2025-04-12T08:30:00.000Z';

function start(overrides: Parameters<typeof startRuntime>[0] = {}): RuntimeHarness {
  return startRuntime({ renderers: buildBuiltinRenderers(), autoBind: 'unique', ...overrides });
}

/** One message per call, each flushed before the next. */
async function send(...messages: Record<string, unknown>[]): Promise<void> {
  for (const data of messages) {
    post(data);
    await vi.advanceTimersByTimeAsync(50);
  }
}

describe('a value that stands alone in exactly one place', () => {
  it('binds the element as if data-payload-field had been written there', async () => {
    document.body.innerHTML = `<article><h1>${TITLE}</h1><p>Some other text.</p></article>`;
    const harness = start();

    await send({ title: TITLE }, { title: 'An edited title' });

    const h1 = document.querySelector('h1');
    expect(h1?.textContent).toBe('An edited title');
    expect(h1?.getAttribute('data-payload-field')).toBe('title');
    expect(h1?.getAttribute('data-payload-guessed')).toBe(TITLE);
    harness.runtime.destroy();
  });

  it('trims the whitespace a template’s formatting put around the text', async () => {
    document.body.innerHTML = `<h1>\n      ${TITLE}\n    </h1>`;
    const harness = start();

    await send({ title: TITLE }, { title: 'Edited' });

    expect(document.querySelector('h1')?.textContent).toBe('Edited');
    harness.runtime.destroy();
  });

  it('reads one level into a group, under the dotted name a binding would carry', async () => {
    document.body.innerHTML = '<p class="caption">Mountains at dusk</p>';
    const harness = start();

    await send({ hero: { alt: 'Mountains at dusk' } }, { hero: { alt: 'Hills at dawn' } });

    expect(document.querySelector('p')?.textContent).toBe('Hills at dawn');
    expect(document.querySelector('p')?.getAttribute('data-payload-field')).toBe('hero.alt');
    harness.runtime.destroy();
  });

  it('strips the locale suffix Payload appends, so the binding reads the localised value', async () => {
    document.body.innerHTML = '<h1>Hallo aus der Demo</h1>';
    const harness = start();

    post({ title_de: 'Hallo aus der Demo' }, { extra: { locale: 'de' } });
    await vi.advanceTimersByTimeAsync(50);
    post({ title_de: 'Servus aus der Demo' }, { extra: { locale: 'de' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('h1')?.getAttribute('data-payload-field')).toBe('title');
    expect(document.querySelector('h1')?.textContent).toBe('Servus aus der Demo');
    harness.runtime.destroy();
  });

  it('binds an attribute the writer may set, through data-payload-attribute', async () => {
    document.body.innerHTML = '<figure><img src="/a.jpg" alt="Mountains at dusk"></figure>';
    const harness = start();

    await send({ hero: { alt: 'Mountains at dusk' } }, { hero: { alt: 'Hills at dawn' } });

    const img = document.querySelector('img');
    expect(img?.getAttribute('data-payload-field')).toBe('hero.alt');
    expect(img?.getAttribute('data-payload-attribute')).toBe('alt');
    expect(img?.alt).toBe('Hills at dawn');
    expect(img?.getAttribute('src')).toBe('/a.jpg');
    harness.runtime.destroy();
  });
});

describe('one element, two fields: the idiom a template would write', () => {
  it('folds an image’s src and alt into data-payload-alt when two scalars matched them', async () => {
    const url = 'https://images.example.com/photo-1469474968028.jpg';
    document.body.innerHTML = `<img src="${url}" alt="Mountains at dusk">`;
    const harness = start();

    await send(
      { heroImage: url, heroAlt: 'Mountains at dusk' },
      { heroImage: 'https://images.example.com/other.jpg', heroAlt: 'Hills at dawn' },
    );

    const img = document.querySelector('img');
    expect(img?.getAttribute('data-payload-field')).toBe('heroImage');
    expect(img?.getAttribute('data-payload-alt')).toBe('heroAlt');
    expect(img?.getAttribute('src')).toBe('https://images.example.com/other.jpg');
    expect(img?.alt).toBe('Hills at dawn');
    harness.runtime.destroy();
  });

  it('binds an upload to the <img> that shows its file, by the file’s url', async () => {
    const url = 'https://cms.example.com/media/photo-1469474968028.jpg';
    document.body.innerHTML = `<figure><img src="${url}" alt="Mountains at dusk"></figure>`;
    const harness = start();

    await send(
      { hero: { id: 3, url, alt: 'Mountains at dusk', filename: 'photo-1469474968028.jpg' } },
      { hero: { id: 4, url: 'https://cms.example.com/media/other.jpg', alt: 'Hills at dawn' } },
    );

    const img = document.querySelector('img');
    // The field itself, not a scalar under it: the image renderer reads the
    // media object, which is what a template declares for an upload.
    expect(img?.getAttribute('data-payload-field')).toBe('hero');
    expect(img?.hasAttribute('data-payload-attribute')).toBe(false);
    expect(img?.getAttribute('src')).toBe('https://cms.example.com/media/other.jpg');
    expect(img?.alt).toBe('Hills at dawn');
    expect(harness.runtime.inspect().bindings.guessed).toEqual([
      { field: 'hero', matched: url, attribute: 'src' },
    ]);
    harness.runtime.destroy();
  });

  it('folds a link’s text and href into data-payload-href', async () => {
    document.body.innerHTML = '<p><a href="https://payloadcms.com">Visit Payload</a></p>';
    const harness = start();

    await send(
      { ctaLabel: 'Visit Payload', ctaUrl: 'https://payloadcms.com' },
      { ctaLabel: 'Visit the docs', ctaUrl: 'https://payloadcms.com/docs' },
    );

    const a = document.querySelector('a');
    expect(a?.getAttribute('data-payload-field')).toBe('ctaLabel');
    expect(a?.getAttribute('data-payload-href')).toBe('ctaUrl');
    expect(a?.textContent).toBe('Visit the docs');
    expect(a?.getAttribute('href')).toBe('https://payloadcms.com/docs');
    harness.runtime.destroy();
  });

  it('binds a link’s text alone as text, so the href it did not match stays', async () => {
    document.body.innerHTML = '<a href="/contact">Get in touch today</a>';
    const harness = start();

    await send({ ctaLabel: 'Get in touch today' }, { ctaLabel: 'Write to us' });

    const a = document.querySelector('a');
    // The url renderer would derive an href from the text; forcing the text
    // renderer is what keeps a guess from clearing a link it never matched.
    expect(a?.getAttribute('data-payload-type')).toBe('text');
    expect(a?.textContent).toBe('Write to us');
    expect(a?.getAttribute('href')).toBe('/contact');
    harness.runtime.destroy();
  });
});

describe('when it does not search', () => {
  it('does nothing under the default', async () => {
    document.body.innerHTML = `<h1>${TITLE}</h1>`;
    const harness = startRuntime({ renderers: buildBuiltinRenderers() });

    await send({ title: TITLE }, { title: 'Edited' });

    expect(document.querySelector('h1')?.textContent).toBe(TITLE);
    expect(document.querySelectorAll('[data-payload-field]')).toHaveLength(0);
    harness.runtime.destroy();
  });

  it('searches once: a value that first appears in the second message is never bound', async () => {
    document.body.innerHTML = '<h1>The second message value</h1>';
    const harness = start();

    await send(
      { title: 'The first message value' },
      { title: 'The second message value' },
      { title: 'A third message value' },
    );

    // By the second message the DOM is what the runtime made it; matching
    // against one's own output would be circular (ADR 0014 §1).
    expect(document.querySelector('h1')?.textContent).toBe('The second message value');
    expect(harness.runtime.inspect().bindings.guessed).toEqual([]);
    harness.runtime.destroy();
  });

  it('never enters a subtree opted out with data-payload-no-bind, declared or not', async () => {
    document.body.innerHTML = `<aside data-payload-no-bind><h1>${TITLE}</h1></aside>`;
    const harness = start();

    await send({ title: TITLE }, { title: 'Edited' });

    expect(document.querySelector('h1')?.textContent).toBe(TITLE);
    harness.runtime.destroy();
  });
});

describe('telling a guess from a declaration', () => {
  it('inspect() names the value each guess matched on, apart from the declared bindings', async () => {
    document.body.innerHTML =
      `<h1>${TITLE}</h1><p data-payload-field="subtitle">Declared by the template</p>` +
      '<img src="/a.jpg" alt="Mountains at dusk">';
    const harness = start();

    await send({
      title: TITLE,
      subtitle: 'Declared by the template',
      hero: { alt: 'Mountains at dusk' },
    });

    const { bindings } = harness.runtime.inspect();
    expect(bindings.fieldNames).toEqual(['hero.alt', 'subtitle', 'title']);
    expect(bindings.guessed).toEqual([
      { field: 'hero.alt', matched: 'Mountains at dusk', attribute: 'alt' },
      { field: 'title', matched: TITLE, attribute: undefined },
    ]);
    expect(bindings.autoBind.mode).toBe('unique');
    expect(bindings.autoBind.searchMs).toBeGreaterThanOrEqual(0);
    harness.runtime.destroy();
  });

  it('reports the mode and no search before the first message', () => {
    document.body.innerHTML = `<h1>${TITLE}</h1>`;
    const harness = start();

    expect(harness.runtime.inspect().bindings.autoBind).toEqual({
      mode: 'unique',
      searchMs: undefined,
    });
    harness.runtime.destroy();
  });

  it('says what it guessed in the debug log', async () => {
    document.body.innerHTML = `<h1>${TITLE}</h1>`;
    const harness = start();

    await send({ title: TITLE });

    expect(harness.logs.some((line) => line.includes('autoBind') && line.includes('title'))).toBe(
      true,
    );
    harness.runtime.destroy();
  });

  it('survives the cache rebuild the stamp itself triggers', async () => {
    document.body.innerHTML = `<h1>${TITLE}</h1>`;
    const harness = start();

    await send({ title: TITLE });
    // The mutation observer sees the stamped attribute and rebuilds the cache
    // after its debounce; the guess must come back as the binding it is.
    await vi.advanceTimersByTimeAsync(200);
    await send({ title: 'Edited after the rebuild' });

    expect(document.querySelector('h1')?.textContent).toBe('Edited after the rebuild');
    expect(harness.runtime.inspect().bindings.guessed).toHaveLength(1);
    harness.runtime.destroy();
  });

  it('inherits no format: a guessed <time> reports LP0412 on its first write', async () => {
    // Z20's expectation, written down: the template printed the stored
    // instant, the date renderer formats it, and the difference is said once.
    document.body.innerHTML = `<p>Published: <time datetime="${ISO}">${ISO}</time></p>`;
    const harness = start();

    await send({ publishedAt: ISO });

    expect(document.querySelector('time')?.getAttribute('data-payload-field')).toBe('publishedAt');
    expect(harness.warnings.filter((line) => line.includes('LP0412'))).toHaveLength(1);
    harness.runtime.destroy();
  });
});
