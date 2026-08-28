/** Minimal static file server for the built dist/, no dependencies. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT ?? 4181);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    // Contain within dist; reject traversal.
    const file = normalize(join(dist, path));
    if (!file.startsWith(dist)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`pure-html on http://localhost:${port}`));
