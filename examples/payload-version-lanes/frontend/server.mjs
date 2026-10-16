/**
 * The local service renders the same native component tree it later hydrates.
 * It serves only its compiled static assets and two explicit document markers;
 * authorization/population remains the real isolated Payload admin's REST API.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const identity = JSON.parse(await readFile(resolve(root, 'identity.json'), 'utf8'));
const admin = process.env.PLP_R6_ADMIN;
const surface = process.env.PLP_R6_SURFACE;
assert.ok(admin && ['react', 'vue'].includes(surface));
const { render } = await import(
  pathToFileURL(resolve(root, 'dist/ssr/' + surface + '-ssr.mjs')).href
);
const server = createServer((request, response) => {
  void (async () => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
      if (url.pathname === '/__r6/identity') {
        response
          .writeHead(200, { ...headers, 'content-type': 'application/json' })
          .end(JSON.stringify(identity));
        return;
      }
      if (url.pathname === '/message-target.html') {
        response
          .writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' })
          .end('<!doctype html><title>Native receiver target</title><body>Receiver target</body>');
        return;
      }
      if (url.pathname === '/' + surface + '.html') {
        const document = url.searchParams.get('document') ?? 'homepage';
        assert.ok(['homepage', 'otherpage'].includes(document));
        const props = { admin, document };
        const html = await render(props);
        const encoded = JSON.stringify(props).replaceAll('<', '\\u003c');
        response
          .writeHead(200, {
            ...headers,
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy':
              "default-src 'none'; script-src 'self'; connect-src " +
              admin +
              '; frame-ancestors ' +
              admin,
          })
          .end(
            '<!doctype html><html><head><title>R6 native ' +
              surface +
              '</title></head><body><div id="app">' +
              html +
              '</div><script id="r6-props" type="application/json">' +
              encoded +
              '</script><script type="module" src="/assets/' +
              surface +
              '-client.js"></script></body></html>',
          );
        return;
      }
      const assets = resolve(root, 'dist/assets');
      const file = resolve(assets, '.' + url.pathname.replace(/^\/assets/u, ''));
      const from = relative(assets, file);
      assert.ok(
        url.pathname.startsWith('/assets/') && from !== '..' && !from.startsWith('..' + sep),
      );
      const content = await readFile(file);
      response
        .writeHead(200, { ...headers, 'content-type': 'text/javascript; charset=utf-8' })
        .end(content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  })();
});
server.listen(Number(process.env.PORT), '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close(() => process.exit(0)));
