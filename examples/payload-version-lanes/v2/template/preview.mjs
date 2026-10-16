/**
 * This separate Node preview uses only the installed candidate's public entries.
 * Each preview request verifies the real editor session and uses the accepted
 * minimal headers for the initial global read. No synthetic message authorizes it.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { generateInlineScript } from 'payload-live-preview';
import { authorizePreviewRequest } from 'payload-live-preview/server';
import diagnostics from './diagnostics.cjs';

const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const redact = diagnostics.redactor(settings);
const native = settings.surface !== 'dom';
let render;
let client;
if (native) {
  ({ render } = await import('./frontend/dist/ssr/' + settings.surface + '-ssr.mjs'));
  client = readFileSync(
    new URL('./frontend/dist/assets/' + settings.surface + '-client.js', import.meta.url),
  );
}
const escaped = (value) =>
  String(value ?? '').replace(
    /[&<>"']/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

async function authorize(request, mode = 'default', calls = []) {
  return authorizePreviewRequest(
    {
      url: settings.site + request.url,
      headers: new Headers({
        ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
      }),
    },
    {
      type: 'payload-session',
      serverURL: settings.admin,
      ...(mode === 'site'
        ? { origin: settings.site }
        : mode === 'admin'
          ? { origin: settings.admin }
          : mode === 'unlisted'
            ? { origin: 'https://unlisted.example.invalid' }
            : {}),
      fetch: async (input, init) => {
        const headers = new Headers(init.headers);
        calls.push({
          path: new URL(input).pathname,
          hasCookie: headers.has('cookie'),
          origin: headers.get('origin'),
        });
        return fetch(input, init);
      },
    },
  );
}

async function handle(request, response) {
  const url = new URL(request.url, settings.site);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Vary', 'Cookie');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (url.pathname === '/__plp_health') {
    response.setHeader('Content-Type', 'application/json');
    return response.end(JSON.stringify({ ready: true }));
  }
  if (url.pathname === '/__probe/session') {
    const calls = [];
    const mode = url.searchParams.get('mode') ?? 'default';
    if (!['default', 'site', 'admin', 'unlisted'].includes(mode)) {
      response.statusCode = 400;
      return response.end('Unknown probe mode');
    }
    const verdict = await authorize(request, mode, calls);
    response.setHeader('Content-Type', 'application/json');
    return response.end(
      JSON.stringify({
        authorized: verdict.authorized,
        outcome: verdict.outcome,
        calls,
        payloadHeaderNames: Object.keys(verdict.context?.payloadHeaders ?? {}).sort(),
      }),
    );
  }
  if (native && url.pathname === '/assets/' + settings.surface + '-client.js') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    return response.end(client);
  }
  if (url.pathname !== (native ? '/' + settings.surface : '/')) {
    response.statusCode = 404;
    return response.end();
  }
  const slug = native ? (url.searchParams.get('document') ?? 'homepage') : 'homepage';
  if (!['homepage', 'otherpage'].includes(slug)) {
    response.statusCode = 400;
    return response.end();
  }
  const intent = url.searchParams.get('preview') === 'true';
  const verdict = intent ? await authorize(request) : { authorized: false };
  const nonce = randomBytes(18).toString('base64url');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'none'; connect-src 'self' ${settings.admin}; frame-ancestors ${settings.admin}; object-src 'none'; base-uri 'none'`,
  );
  let document = { title: 'Public page', subtitle: 'No editor runtime' };
  let inline = '';
  if (verdict.authorized) {
    const read = await fetch(settings.admin + '/api/globals/' + slug + '?depth=1', {
      headers: verdict.context.payloadHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!read.ok) throw new Error('Authorized initial Payload global read failed');
    document = await read.json();
    if (native) {
      const props = { admin: settings.admin, document: slug, initialData: document };
      const markup = await render(props);
      const encoded = JSON.stringify(props).replaceAll('<', '\\u003c');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; connect-src " +
          settings.admin +
          '; frame-ancestors ' +
          settings.admin +
          "; base-uri 'none'; object-src 'none'",
      );
      return response.end(
        '<!doctype html><html><head><title>Payload 2 native ' +
          settings.surface +
          '</title></head><body><div id="app">' +
          markup +
          '</div><script id="r6-props" type="application/json">' +
          encoded +
          '</script><script type="module" src="/assets/' +
          settings.surface +
          '-client.js"></script></body></html>',
      );
    }
    inline = `<script nonce="${nonce}">${generateInlineScript({ allowedOrigins: [settings.admin], disableLocalhostMatching: true, disableReferrerDetection: true, serverURL: settings.admin, mergeDepth: 1, debounceMs: 25 })}</script>`;
  }
  response.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payload 2 real admin fixture</title>${inline}</head><body><main><h1 data-payload-field="title">${escaped(document.title)}</h1><p data-payload-field="subtitle">${escaped(document.subtitle)}</p><p data-payload-field="author.name">${escaped(document.author?.name)}</p><section data-payload-field="body" data-payload-type="richText"></section><ul data-payload-field="tags" data-payload-type="array" data-payload-array-template="&lt;li&gt;{{label}}&lt;/li&gt;"></ul></main></body></html>`,
  );
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(diagnostics.diagnostic(error, redact));
    response.statusCode = 503;
    response.end('Preview fixture request failed');
  });
});
server.listen(settings.sitePort, '127.0.0.1', () =>
  console.log('Payload 2 preview listening on loopback'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => server.close(() => process.exit(0)));
