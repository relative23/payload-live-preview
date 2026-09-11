import { describe, expect, it } from 'vitest';
import { LivePreviewScript } from '@adapters/nextjs/index';
import { livePreviewScriptProps } from '@adapters/nextjs/adapter';
import { authorizePreviewRequest } from '@security/preview-authorization';

/**
 * LP-8, measured on 6 September in the demo: a `curl` without a cookie on
 * `/de/magazin/die-lichtprobe` came back with 195 342 of 254 707 bytes of
 * preview runtime — the script once in the document and once more, escaped,
 * in the RSC flight payload underneath it. Nothing on that request was a
 * preview: no session, no intent, no editor.
 *
 * The cause is not the runtime's size but where it is rendered. A root layout
 * renders for every visitor, and the two helpers a layout had until now —
 * `livePreviewScriptProps()` and `renderLivePreviewScript()` — are synchronous
 * and decide nothing: they build the script, whoever is asking.
 *
 * `<LivePreviewScript />` is an async server component, so it can await the
 * authorization verdict before it renders anything at all. These tests hold
 * both halves of that: nothing for a request that is not a preview, and the
 * same bytes as before for one that is.
 */

const ADMIN = 'https://admin.example.com';
const SITE = 'https://site.example.com';
const SESSION = 'payload-token=abc';

/** The Payload admin's own check, stood in for so the component's side is what is measured. */
const authorizePreview = (request: Request) =>
  authorizePreviewRequest(request, {
    type: 'verifier',
    verify: ({ headers }) =>
      (headers.get('cookie') ?? '').includes('payload-token=') ? { subject: 'editor' } : null,
  });

const options = {
  allowedOrigins: [ADMIN],
  authorizePreview,
} as const;

/** The element an async server component resolves to, as much of it as this asserts on. */
interface ScriptElement {
  readonly props: {
    readonly dangerouslySetInnerHTML: { readonly __html: string };
    readonly nonce?: string;
  };
}

function elementOf(rendered: unknown): ScriptElement {
  expect(rendered, 'the component rendered a script element').not.toBeNull();
  return rendered as ScriptElement;
}

describe('LivePreviewScript', () => {
  it('renders nothing for the request an anonymous visitor makes', async () => {
    // The LP-8 request itself: no cookie, no `?preview=true`, no admin referer.
    const rendered = await LivePreviewScript({
      ...options,
      request: new Request(`${SITE}/magazin/die-lichtprobe`),
    });

    expect(rendered).toBeNull();
  });

  it('renders the runtime for an authorized preview, byte for byte as the props helper does', async () => {
    const rendered = await LivePreviewScript({
      ...options,
      request: new Request(`${SITE}/magazin/die-lichtprobe?preview=true`, {
        headers: { cookie: SESSION },
      }),
    });

    // The synchronous helper stays the reference: this component decides who
    // gets the script, not what is in it.
    expect(elementOf(rendered).props.dangerouslySetInnerHTML.__html).toBe(
      livePreviewScriptProps(options).dangerouslySetInnerHTML.__html,
    );
  });

  it('renders nothing for intent that no session backs', async () => {
    // ADR 0006: `?preview=true` is client-controlled, so it is a delivery hint
    // and never the verdict. Anyone may append it to a URL.
    const rendered = await LivePreviewScript({
      ...options,
      request: new Request(`${SITE}/magazin/die-lichtprobe?preview=true`),
    });

    expect(rendered).toBeNull();
  });

  it('renders nothing for a session without intent, so a signed-in editor browsing the site pays nothing', async () => {
    const rendered = await LivePreviewScript({
      ...options,
      request: new Request(`${SITE}/magazin/die-lichtprobe`, { headers: { cookie: SESSION } }),
    });

    expect(rendered).toBeNull();
  });

  it('awaits a request the caller has not resolved yet', async () => {
    // `headers()` is a promise in the App Router, so the request a layout can
    // build is one too; making the caller await it first buys nothing.
    const rendered = await LivePreviewScript({
      ...options,
      request: Promise.resolve(
        new Request(`${SITE}/?preview=true`, { headers: { cookie: SESSION } }),
      ),
    });

    expect(elementOf(rendered).props.dangerouslySetInnerHTML.__html).toContain(
      '__LIVE_PREVIEW_CONFIG__',
    );
  });

  it('carries the nonce as a prop, and only when it renders at all', async () => {
    const authorized = await LivePreviewScript({
      ...options,
      nonce: 'abc123',
      request: new Request(`${SITE}/?preview=true`, { headers: { cookie: SESSION } }),
    });

    expect(elementOf(authorized).props.nonce).toBe('abc123');
    expect(elementOf(authorized).props.dangerouslySetInnerHTML.__html).not.toContain('abc123');
    expect(
      await LivePreviewScript({ ...options, nonce: 'abc123', request: new Request(SITE) }),
    ).toBe(null);
  });

  it('defers to the delivery the options chose, so an asset build stays an asset build', async () => {
    const rendered = await LivePreviewScript({
      ...options,
      delivery: 'asset',
      request: new Request(`${SITE}/?preview=true`, { headers: { cookie: SESSION } }),
    });

    const html = elementOf(rendered).props.dangerouslySetInnerHTML.__html;
    expect(html).toContain('__LP_RUNTIME_SRC__');
    expect(html.length).toBeLessThan(4_000);
  });

  it('renders nothing when injection is switched off, and leaves the header side to the middleware', async () => {
    const rendered = await LivePreviewScript({
      ...options,
      autoInject: false,
      request: new Request(`${SITE}/?preview=true`, { headers: { cookie: SESSION } }),
    });

    expect(rendered).toBeNull();
  });

  it('lets the route filter refuse a page even when the visitor is an editor', async () => {
    const rendered = await LivePreviewScript({
      ...options,
      shouldInject: (request: Request) => !new URL(request.url).pathname.startsWith('/checkout'),
      request: new Request(`${SITE}/checkout?preview=true`, { headers: { cookie: SESSION } }),
    });

    expect(rendered).toBeNull();
  });
});
