/**
 * A schema-free error-envelope heuristic collides with legitimate Payload data.
 * This probe runs the installed config sanitizer and REST handler; only the
 * empty database is stubbed, so it is not a database or authentication E2E.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Probe an explicitly supplied installation; Payload is not a root dependency.
const installation = process.argv[2];
assert.ok(installation, 'Pass the directory of an installed Payload package.');
const payloadRoot = pathToFileURL(`${resolve(installation)}/`);
const manifest = JSON.parse(readFileSync(new URL('package.json', payloadRoot), 'utf8')) as {
  readonly name: string;
  readonly version: string;
};
assert.equal(manifest.name, 'payload');
const { sanitizeGlobal } = (await import(
  new URL('dist/globals/config/sanitize.js', payloadRoot).href
)) as {
  readonly sanitizeGlobal: (config: object, global: object) => Promise<{ readonly slug: string }>;
};
const { findOneHandler } = (await import(
  new URL('dist/globals/endpoints/findOne.js', payloadRoot).href
)) as {
  readonly findOneHandler: (request: object) => Promise<Response>;
};

const config = { collections: [], defaultDepth: 1, maxDepth: 10, localization: false };
const globalConfig = await sanitizeGlobal(config, {
  slug: 'diagnostics',
  access: { read: () => true },
  fields: [{ name: 'errors', type: 'json' }],
});
const data = { errors: [{ message: 'Editorial content, not an API failure' }] };
const response = await findOneHandler({
  routeParams: { global: globalConfig.slug },
  data: { data, depth: 1, flattenLocales: false },
  query: {},
  searchParams: new URLSearchParams(),
  headers: new Headers(),
  context: {},
  payload: {
    config,
    globals: { config: [globalConfig] },
    db: { findGlobal: () => Promise.resolve(null) },
  },
});
const result: unknown = await response.json();
assert.equal(response.status, 200);
assert.deepEqual(result, data);
console.log(
  JSON.stringify({
    payload: manifest.version,
    implementation: 'installed Payload config sanitizer and global REST handler',
    database: 'stubbed empty global',
    httpStatus: response.status,
    result,
  }),
);
