/**
 * A link to a document in the same CMS is a route only the site knows. Without
 * help the renderer can offer `/<slug>`, which on a site with locale prefixes or
 * trailing slashes points somewhere else than the server's own link.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { lexicalToHtml } from '@lexical/render';
import { LivePreviewRuntime } from '@core/lifecycle';
import { EventEmitter } from '@events/emitter';
import { bootstrapInlineRuntime } from '@core/runtime';
import { INLINE_CONFIG_KEYS } from '@/types/inline-config';
import { LivePreviewClient } from '@/client/index';
import { IO, TRUSTED, fireMessage } from '../core/lifecycle-startup-harness';

function linkTo(doc: unknown): Parameters<typeof lexicalToHtml>[0] {
  return {
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'link',
          version: 3,
          fields: { linkType: 'internal', doc },
          children: [{ type: 'text', version: 1, text: 'Go', format: 0 }],
        },
      ],
    },
  };
}

const page = { relationTo: 'pages', value: { id: 7, slug: 'über uns' } };
const hrefOf = (html: string): string | null =>
  new DOMParser().parseFromString(html, 'text/html').querySelector('a')?.getAttribute('href') ??
  null;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('internalLinkPattern', () => {
  it('builds the link from the placeholders, each encoded', () => {
    const html = lexicalToHtml(linkTo(page), {
      internalLinkPattern: '/{locale}/{collection}/{slug}/?id={id}',
      locale: 'de',
    });
    expect(hrefOf(html)).toBe('/de/pages/%C3%BCber%20uns/?id=7');
  });

  it('keeps /<slug> without a pattern', () => {
    expect(hrefOf(lexicalToHtml(linkTo(page)))).toBe('/über uns');
  });

  it("prefers the document's own url, which the site computed", () => {
    const html = lexicalToHtml(
      linkTo({ relationTo: 'pages', value: { id: 7, slug: 'home', url: '/' } }),
      { internalLinkPattern: '/{slug}/' },
    );
    expect(hrefOf(html)).toBe('/');
  });

  it('builds from an id alone, when the relation was not populated', () => {
    const html = lexicalToHtml(linkTo({ relationTo: 'pages', value: 7 }), {
      internalLinkPattern: '/{collection}/{id}',
    });
    expect(hrefOf(html)).toBe('/pages/7');
  });

  it('falls back when a placeholder has no value', () => {
    expect(hrefOf(lexicalToHtml(linkTo(page), { internalLinkPattern: '/{locale}/{slug}/' }))).toBe(
      '/über uns',
    );
    // No slug to fall back on either: the text stays, without a link.
    expect(
      hrefOf(
        lexicalToHtml(linkTo({ relationTo: 'pages', value: 7 }), {
          internalLinkPattern: '/{slug}/',
        }),
      ),
    ).toBeNull();
  });

  it('leaves an unknown placeholder as written', () => {
    expect(hrefOf(lexicalToHtml(linkTo(page), { internalLinkPattern: '/{slug}/{other}' }))).toBe(
      '/%C3%BCber%20uns/{other}',
    );
  });

  it('refuses what the URL check refuses', () => {
    expect(
      hrefOf(lexicalToHtml(linkTo(page), { internalLinkPattern: 'javascript:alert({id})' })),
    ).toBeNull();
  });
});

describe('the runtime', () => {
  let runtime: LivePreviewRuntime | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', IO);
  });
  afterEach(() => {
    runtime?.destroy();
    runtime = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('writes the pattern into a rich-text binding, with the locale of the binding', async () => {
    document.body.innerHTML =
      '<div data-payload-field="body" data-payload-richtext="" data-payload-locale="de"></div>';
    runtime = new LivePreviewRuntime({
      renderers: buildBuiltinRenderers(),
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      internalLinkPattern: '/{locale}/{slug}/',
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      data: { body: linkTo({ relationTo: 'pages', value: { id: 7, slug: 'a' } }) },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/de/a/');
  });

  describe('on the way from the options', () => {
    const body = (): Record<string, unknown> => ({
      body: linkTo({ relationTo: 'pages', value: { id: 7, slug: 'a' } }),
    });
    const hrefShown = async (): Promise<string | null | undefined> => {
      fireMessage({ type: 'payload-live-preview', data: body() });
      await vi.advanceTimersByTimeAsync(100);
      return document.querySelector('a')?.getAttribute('href');
    };

    beforeEach(() => {
      document.body.innerHTML = '<div data-payload-field="body" data-payload-richtext=""></div>';
      // Both start only in a preview context, and a popup's opener is the simplest one to give.
      Object.defineProperty(window, 'opener', { value: {}, configurable: true, writable: true });
    });
    afterEach(() => {
      Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
    });

    it.each([
      ['/{slug}/', '/a/'],
      [undefined, '/a'],
    ])('reaches the write from the inline slot: %s', async (pattern, expected) => {
      const given: Partial<Record<(typeof INLINE_CONFIG_KEYS)[number], unknown>> = {
        allowedOrigins: [TRUSTED],
        eventSourcePolicy: 'any',
        debounceMs: 0,
        disableVisibilityGate: true,
        internalLinkPattern: pattern,
      };
      vi.stubGlobal(
        '__LIVE_PREVIEW_CONFIG__',
        INLINE_CONFIG_KEYS.map((key) => given[key]),
      );
      const api = bootstrapInlineRuntime();
      expect(await hrefShown()).toBe(expected);
      api?.destroy();
      delete (window as { __livePreview?: unknown }).__livePreview;
    });

    it('reaches the write from LivePreviewClient', async () => {
      const client = new LivePreviewClient({
        allowedOrigins: [TRUSTED],
        eventSourcePolicy: 'any',
        debounceMs: 0,
        disableVisibilityGate: true,
        internalLinkPattern: '/{slug}/',
      });
      client.start();
      expect(await hrefShown()).toBe('/a/');
      await client.destroy();
    });
  });
});
