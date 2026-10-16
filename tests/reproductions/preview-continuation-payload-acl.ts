/**
 * Actual SQLite, Payload REST/authentication and a clean packed server entry.
 * The host cookie/store are application-side test references, not a browser,
 * distributed session service or unsaved relationship-population protocol.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as ServerEntry from '../../src/server/index';
import { createACLReference, type ACLFixture } from '../fixtures/payload-acl-reference';
import { createReferenceDataHandler } from '../fixtures/preview-continuation-data';

const installation = process.argv[2];
assert.ok(installation, 'Pass the isolated fixture directory with the installed tarball');
const directory = realpathSync(resolve(installation));
assert.ok(
  !directory.startsWith(`${process.cwd()}${sep}`),
  'Fixture must be outside this workspace',
);
const require = createRequire(resolve(directory, 'package.json'));
const serverPath = realpathSync(require.resolve('payload-live-preview/server'));
assert.ok(serverPath.startsWith(`${directory}${sep}`), 'No workspace package fallback');
const entry = (await import(pathToFileURL(serverPath).href)) as typeof ServerEntry;
const fixtureModule = (await import(pathToFileURL(resolve(directory, 'acl-fixture.ts')).href)) as {
  startACLFixture(): Promise<ACLFixture>;
};
const cases: { name: string; result: string }[] = [];
const observations: Record<string, unknown> = {};
async function check(name: string, action: () => void | Promise<void>) {
  try {
    await action();
    cases.push({ name, result: 'pass' });
  } catch (error) {
    cases.push({ name, result: 'fail' });
    // Only assertions about synthetic fixture content are exposed. Network and
    // backend error objects can carry credentials and must not be serialized.
    console.error(name, error instanceof assert.AssertionError ? error.message : 'Probe error');
    process.exitCode = 1;
  }
}
function scalarId(value: unknown): string {
  assert.ok(typeof value === 'string' || typeof value === 'number', 'Unpopulated value is an ID');
  return String(value);
}
async function document(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body['version'], 1);
  assert.equal(body['ok'], true);
  assert.ok(body['data'] && typeof body['data'] === 'object' && !Array.isArray(body['data']));
  return body['data'] as Record<string, unknown>;
}
async function refusal(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body['ok'], false);
  assert.equal(Object.hasOwn(body, 'data'), false);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'ok', 'version']);
}

const fixture = await fixtureModule.startACLFixture();
try {
  const h = createACLReference(fixture, entry);
  const identities = { a: await h.login('a'), b: await h.login('b') };
  const id = (key: string) => {
    const value = fixture.ids[key];
    assert.ok(value);
    return value;
  };
  const target = (editor: string) => ({
    kind: 'collection' as const,
    slug: 'articles',
    id: id(`article-${editor}`),
  });
  const pages = {
    a: await h.open(identities.a, target('a')),
    b: await h.open(identities.b, target('b')),
  };
  for (const editor of ['a', 'b'] as const) {
    const other = editor === 'a' ? 'b' : 'a';
    const identity = identities[editor];
    const page = pages[editor];
    await check(
      `${editor}: initial and repeated localized draft with restricted population`,
      async () => {
        const first = await document(await h.data(page.request()));
        const repeated = await document(await h.data(page.request()));
        assert.deepEqual(repeated, first);
        assert.equal(String(first['id']), id(`article-${editor}`));
        assert.equal(first['title'], `${editor}-draft-de`);
        assert.equal(first['_status'], 'draft');
        const related = first['related'] as Record<string, unknown>[];
        const files = first['files'] as Record<string, unknown>[];
        // Pin actual denied-population shape rather than accepting every shape
        // that happens not to contain the other editor's title.
        assert.equal(related.length, 2);
        assert.equal(files.length, 2);
        const own = related[editor === 'a' ? 0 : 1]!;
        assert.equal(own['title'], `${editor}-root-de`);
        assert.equal((own['next'] as Record<string, unknown>)['title'], `${editor}-leaf-de`);
        assert.equal(scalarId(related[editor === 'a' ? 1 : 0]), id(`${other}-root`));
        assert.equal(scalarId(files[editor === 'a' ? 1 : 0]), id(`media-${other}`));
        assert.equal(files[editor === 'a' ? 0 : 1]!['title'], `${editor}-file-de`);
        assert.equal(first['editorNotes'], editor === 'a' ? 'a-restricted-note' : undefined);
        assert.equal(JSON.stringify(first).includes(`${other}-root-de`), false);
        observations[`${editor}-denied-population`] = { relationship: 'id', upload: 'id' };
      },
    );
    await check(`${editor}: depth zero and one are actual population limits`, async () => {
      for (const depth of [0, 1]) {
        const shallow = await h.open(identity, target(editor), 'de', depth);
        const data = await document(await h.data(shallow.request()));
        assert.deepEqual(await document(await h.data(shallow.request())), data);
        const related = data['related'] as (number | Record<string, unknown>)[];
        const own = related[editor === 'a' ? 0 : 1]!;
        if (depth === 0) assert.equal(scalarId(own), id(`${editor}-root`));
        else {
          assert.equal((own as Record<string, unknown>)['title'], `${editor}-root-de`);
          assert.equal(String((own as Record<string, unknown>)['next']), id(`${editor}-leaf`));
        }
      }
    });
    await check(
      `${editor}: English scope reads English and refuses locale escalation`,
      async () => {
        const english = await h.open(identity, target(editor), 'en');
        const data = await document(await h.data(english.request()));
        assert.deepEqual(await document(await h.data(english.request())), data);
        assert.equal(data['title'], `${editor}-draft-en`);
        const related = data['related'] as Record<string, unknown>[];
        const files = data['files'] as Record<string, unknown>[];
        assert.equal(related[editor === 'a' ? 0 : 1]!['title'], `${editor}-root-en`);
        assert.equal(files[editor === 'a' ? 0 : 1]!['title'], `${editor}-file-en`);
        await refusal(
          await h.data(
            new Request(english.url.replace('locale=en', 'locale=de'), {
              headers: { cookie: english.cookie },
            }),
          ),
          403,
        );
      },
    );
    await check(
      `${editor}: valid continuation is not an ACL grant for the other document`,
      async () => {
        const forbidden = await h.open(identity, target(other));
        await refusal(await h.data(forbidden.request()), 502);
        const raw = await h.raw(
          `/api/articles/${id(`article-${other}`)}?draft=true`,
          identity.token,
        );
        observations[`${editor}-foreign-document-status`] = raw.status;
        assert.equal(raw.ok, false);
        assert.equal((await document(await h.data(page.request())))['title'], `${editor}-draft-de`);
      },
    );
    await check(
      `${editor}: foreign relation, upload metadata and file bytes remain inaccessible`,
      async () => {
        for (const path of [
          `/api/records/${id(`${other}-root`)}`,
          `/api/media/${id(`media-${other}`)}`,
          `/api/media/file/${other}.txt`,
        ]) {
          const response = await h.raw(path, identity.token);
          assert.equal(response.ok, false, path);
          assert.equal((await response.text()).includes(`${other}-private-file-content`), false);
          observations[`${editor}:${path}`] = response.status;
        }
        const ownFile = await h.raw(`/api/media/file/${editor}.txt`, identity.token);
        assert.equal(ownFile.status, 200);
        assert.equal(await ownFile.text(), `${editor}-private-file-content`);
      },
    );
    await check(
      `${editor}: a different logged-in user cannot reuse this continuation`,
      async () => {
        await refusal(
          await h.data(
            new Request(page.url, {
              headers: { cookie: `${identities[other].cookie}; ${page.continuation}` },
            }),
          ),
          403,
        );
      },
    );
    await check(
      `${editor}: posted/query authority cannot select another target or depth`,
      async () => {
        for (const extra of [
          'depth=10',
          `id=${id(`article-${other}`)}`,
          'locale=all',
          'where[id][exists]=true',
        ]) {
          await refusal(
            await h.data(
              new Request(`${page.url}&${extra}`, {
                headers: { cookie: page.cookie },
              }),
            ),
            extra === 'locale=all' ? 403 : 400,
          );
        }
        await refusal(
          await h.data(
            new Request(page.url, {
              method: 'POST',
              headers: { cookie: page.cookie, 'content-type': 'application/json' },
              body: JSON.stringify({ id: id(`article-${other}`), depth: 10 }),
            }),
          ),
          405,
        );
      },
    );
    await check(`${editor}: package refuses scope escalation before any REST read`, async () => {
      const grant = await h.reference.authorize(page.request());
      assert.ok(grant);
      const before = fixture.requests.length;
      const excessive = await entry
        .definePreview({ serverURL: fixture.origin, depth: 3 })
        .fetchDocument({
          collection: 'articles',
          id: id(`article-${editor}`),
          locale: 'de',
          authorization: grant.context,
        });
      assert.equal(excessive.ok, false);
      assert.equal(excessive.reason, 'scope');
      assert.equal(fixture.requests.length, before);
    });
    await check(
      `${editor}: real global schema, legitimate errors and user-specific population`,
      async () => {
        const global = await h.open(identity, { kind: 'global', slug: 'settings' });
        const first = await document(await h.data(global.request()));
        assert.deepEqual(await document(await h.data(global.request())), first);
        assert.equal(first['title'], 'settings-de');
        assert.deepEqual(first['errors'], [{ message: 'Legitimate editorial field' }]);
        const related = first['related'] as unknown[];
        assert.equal(String(related[editor === 'a' ? 1 : 0]), id(`${other}-root`));
        assert.equal(JSON.stringify(first).includes(`${other}-root-de`), false);
        observations[`${editor}-global`] = {
          keys: Object.keys(first).sort(),
          globalType: first['globalType'] ?? null,
        };
      },
    );
    await check(`${editor}: consumed entry proof remains refused`, async () => {
      assert.equal((await h.reference.exchange(page.initial)).status, 403);
    });
  }
  await check('global ACL distinguishes the two real users', async () => {
    const allowed = await h.raw('/api/globals/restricted?locale=en', identities.a.token);
    const denied = await h.raw('/api/globals/restricted?locale=en', identities.b.token);
    assert.equal(allowed.status, 200);
    assert.equal(denied.status, 403);
    const deniedPage = await h.open(identities.b, { kind: 'global', slug: 'restricted' }, 'en');
    await refusal(await h.data(deniedPage.request()), 502);
  });
  await check(
    'an unseeded real global needs its declared schema rather than an errors heuristic',
    async () => {
      const raw = await h.raw('/api/globals/diagnostics', identities.a.token);
      assert.equal(raw.status, 200);
      const value: unknown = await raw.json();
      assert.deepEqual(value, { errors: 'Editorial diagnostics default' });
      const page = await h.open(identities.a, { kind: 'global', slug: 'diagnostics' });
      const noSchema = createReferenceDataHandler(h.reference, {
        define: entry.definePreview,
        fetch,
      });
      await refusal(await noSchema(page.request()), 502);
      assert.deepEqual(await document(await h.data(page.request())), value);
      observations['unseeded-global'] = {
        keys: ['errors'],
        globalType: null,
        schemaRequired: true,
      };
    },
  );
  await check(
    'anonymous requests never return private documents, population or file bytes',
    async () => {
      for (const path of [
        `/api/articles/${id('article-a')}?draft=true&depth=2&locale=de`,
        `/api/records/${id('a-root')}`,
        `/api/media/${id('media-a')}`,
        '/api/media/file/a.txt',
        '/api/globals/settings?locale=de',
      ]) {
        const response = await h.raw(path);
        assert.equal(response.ok, false, path);
        observations[`anonymous:${path}`] = response.status;
      }
      await refusal(await h.data(new Request(pages.a.url)), 403);
    },
  );
  await check('logout revokes the real Payload session, including saved continuation', async () => {
    const logout = await h.raw('/api/users/logout', identities.a.token, 'POST');
    assert.equal(logout.status, 200);
    const me = await h.raw('/api/users/me', identities.a.token);
    assert.equal(((await me.json()) as { user: unknown }).user, null);
    const before = fixture.requests.filter((request) =>
      request.path.startsWith('/api/articles/'),
    ).length;
    await refusal(await h.data(pages.a.request()), 403);
    const after = fixture.requests.filter((request) =>
      request.path.startsWith('/api/articles/'),
    ).length;
    assert.equal(after, before, 'Revocation is checked before another private read');
    assert.equal((await document(await h.data(pages.b.request())))['title'], 'b-draft-de');
    const replacement = await h.login('a');
    await refusal(
      await h.data(
        new Request(pages.a.url, {
          headers: { cookie: `${replacement.cookie}; ${pages.a.continuation}` },
        }),
      ),
      403,
    );
    const fresh = await h.open(replacement, target('a'));
    assert.equal((await document(await h.data(fresh.request())))['title'], 'a-draft-de');
  });
  await check('the preview path never saves or publishes seeded content', () => {
    assert.equal(fixture.writes(), 0);
    assert.equal(
      fixture.requests.some(
        (request) =>
          request.method !== 'GET' &&
          !['/api/users/login', '/api/users/logout'].includes(request.path),
      ),
      false,
    );
  });
} finally {
  observations['measuredRequests'] = fixture.requests.length;
  observations['contentWrites'] = fixture.writes();
  await fixture.close();
  const manifest = (name: string) =>
    JSON.parse(readFileSync(resolve(directory, 'node_modules', name, 'package.json'), 'utf8')) as {
      version: string;
    };
  console.log(
    JSON.stringify(
      {
        node: process.version,
        payload: manifest('payload').version,
        sqliteAdapter: manifest('@payloadcms/db-sqlite').version,
        package: manifest('payload-live-preview').version,
        packageServerSHA256: createHash('sha256').update(readFileSync(serverPath)).digest('hex'),
        fixtureLockSHA256: createHash('sha256')
          .update(readFileSync(resolve(directory, 'package-lock.json')))
          .digest('hex'),
        cases,
        observations,
      },
      null,
      2,
    ),
  );
}
