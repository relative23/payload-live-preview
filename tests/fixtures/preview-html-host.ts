/**
 * The framework-free host renders only the current, verified page result.
 * It owns HTML escaping and exact route dispatch, while the existing reference
 * retains login, ACL, continuation, body-budget and unsaved revision authority.
 */
import { isAuthorizedPreviewContext } from '@/server/index';
import { createNextHostReference } from './preview-next-host';
import { PRIVATE_HEADERS } from './preview-continuation-data';

interface PageDocument {
  id: number;
  title: string;
  related?: unknown[];
  files?: unknown[];
}
export interface HTMLPreviewView {
  initialData: PageDocument;
  path: string;
  locale: string;
  origin: string;
}
const escape = (value: unknown): string =>
  String(value).replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character]!;
  });
const labels = (values: unknown[] = []): string =>
  values
    .map((value) =>
      typeof value === 'object' && value !== null && 'title' in value
        ? String(value.title)
        : 'ID:' + String(value),
    )
    .join(' | ');
const shell = (content: string, locale = 'en'): string =>
  '<!doctype html><html lang="' +
  escape(locale) +
  '"><head><meta charset="utf-8">' +
  '<title>Local preview host</title></head><body>' +
  content +
  '</body></html>';

export function createHTMLHostReference(
  options: Parameters<typeof createNextHostReference>[0],
  render: (view: HTMLPreviewView) => string | Promise<string> = renderHTMLPage,
): (request: Request) => Promise<Response> {
  const host = createNextHostReference(options);
  const origin = new URL(options.audience);
  const html = (content: string, status: number, locale = 'en'): Response =>
    new Response(shell(content, locale), {
      status,
      headers: {
        ...PRIVATE_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors " +
          origin.origin,
      },
    });
  const refused = (status = 403): Response => html('<h1>Preview unavailable</h1>', status);
  return async (request) => {
    const url = new URL(request.url);
    if (
      url.origin !== origin.origin ||
      request.headers.get('host') !== origin.host ||
      request.headers.get('x-forwarded-proto') !== 'https'
    ) {
      return refused();
    }
    if (url.pathname === '/') {
      if (request.method !== 'GET') return refused(405);
      return new Response(
        shell('<h1>Local editor shell</h1><iframe id="preview" title="Preview"></iframe>'),
        {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      );
    }
    if (url.pathname === '/continuation/login') return host.login(request);
    if (url.pathname === '/continuation/logout') return host.logout(request);
    const route = /^\/continuation\/(a|b)\/(en|de)(\/entry|\/data)?$/u.exec(url.pathname);
    if (!route) return refused(404);
    const path = '/continuation/' + route[1]! + '/' + route[2]!;
    // Only the known endpoint suffix changes. Every client query remains
    // visible to the existing binding validator, including forbidden fields.
    const target = new Request(origin.origin + path + url.search, {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
      ...(request.body ? { body: request.body, duplex: 'half' } : {}),
    });
    if (route[3] === '/entry') return host.exchange(target);
    if (route[3] === '/data') {
      if (request.method === 'GET') return host.load(target);
      if (request.method === 'POST') return host.update(target);
      return refused(405);
    }
    if (request.method !== 'GET') return refused(405);
    const page = await host.page(target);
    if (!page.response.ok || !isAuthorizedPreviewContext(page.authorization)) {
      void page.response.body?.cancel().catch(() => undefined);
      return refused(page.response.ok ? 403 : page.response.status);
    }
    const { data } = (await page.response.json()) as { data: PageDocument };
    const locale = route[2]!;
    // Both HTML and Vue renderers receive presentation data only. The verified
    // context, current credential and stores stay inside this request handler.
    try {
      return html(
        await render({ initialData: data, path, locale, origin: origin.origin }),
        200,
        locale,
      );
    } catch {
      return refused(503);
    }
  };
}

function renderHTMLPage({ initialData: data, path, locale, origin }: HTMLPreviewView): string {
  const config = escape(JSON.stringify({ id: data.id, path, locale, origin }));
  return (
    '<plp-html-preview data-payload-island data-preview-config="' +
    config +
    '">' +
    '<main><h1 data-testid="title">' +
    escape(data.title) +
    '</h1>' +
    '<p data-testid="related">' +
    escape(labels(data.related)) +
    '</p>' +
    '<p data-testid="files">' +
    escape(labels(data.files)) +
    '</p>' +
    '<output data-testid="ready">mounting</output><output data-testid="status">idle</output>' +
    '<button data-testid="counter">0</button><input aria-label="Visitor state" data-testid="visitor" value="Visitor state">' +
    '<a data-testid="valid-navigation" href="' +
    escape(path + '?locale=' + locale + '&preview=true') +
    '">Reload server data</a>' +
    '<a data-testid="denied-navigation" href="' +
    escape(path + '?preview=true&locale=' + locale + '&invalid=1') +
    '">Denied navigation</a>' +
    '</main></plp-html-preview><script type="module" src="/preview.js"></script>'
  );
}
