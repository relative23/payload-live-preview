/**
 * Characterizes real Payload data substitution before trusting an unsaved read.
 * The explicit tarball runs outside workspace resolution; content writes and
 * observed denial shapes are measured on an isolated two-user SQLite fixture.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as ServerEntry from '../../src/server/index';
import { createACLReference, type ACLFixture } from '../fixtures/payload-acl-reference';
import { createReferenceUnsavedHandler } from '../fixtures/preview-continuation-unsaved';

const directory = realpathSync(resolve(process.argv[2]!));
assert.ok(!directory.startsWith(`${process.cwd()}${sep}`));
const require = createRequire(resolve(directory, 'package.json'));
const serverPath = realpathSync(require.resolve('payload-live-preview/server'));
assert.ok(serverPath.startsWith(`${directory}${sep}`));
const entry = (await import(pathToFileURL(serverPath).href)) as typeof ServerEntry;
const fixtureModule = (await import(pathToFileURL(resolve(directory, 'acl-fixture.ts')).href)) as {
  startACLFixture(): Promise<ACLFixture>;
};
const fixture = await fixtureModule.startACLFixture();
const cases: { name: string; result: string }[] = [];
const observations: Record<string, unknown> = {};
async function check(name: string, action: () => void | Promise<void>) {
  try {
    await action();
    cases.push({ name, result: 'pass' });
  } catch (error) {
    cases.push({ name, result: 'fail' });
    console.error(name, error instanceof assert.AssertionError ? error.message : 'Probe error');
    process.exitCode = 1;
  }
}
try {
  const h = createACLReference(fixture, entry);
  const identities = { a: await h.login('a'), b: await h.login('b') };
  const id = (key: string) => {
    const value = fixture.ids[key];
    assert.ok(value);
    return value;
  };
  const relationID = (key: string) => Number(id(key));
  const native = (
    editor: 'a' | 'b',
    article: string,
    data: unknown,
    options: Record<string, unknown> = {},
  ) =>
    fetch(`${fixture.origin}/api/articles/${article}?depth=2&draft=true&locale=de`, {
      method: 'POST',
      headers: {
        authorization: `JWT ${identities[editor].token}`,
        'content-type': 'application/json',
        'x-payload-http-method-override': 'GET',
      },
      body: JSON.stringify({ data, ...options }),
      redirect: 'error',
      cache: 'no-store',
    });
  await check(
    'native: supplied data processes even when the root query-filter ACL denies the saved document',
    async () => {
      const get = await h.raw(
        `/api/articles/${id('article-b')}?depth=0&draft=true&locale=de`,
        identities.a.token,
      );
      assert.equal(get.status, 404);
      const response = await native('a', id('article-b'), {
        id: relationID('article-b'),
        owner: 'b',
        title: 'Posted, not secret',
        related: [relationID('a-root'), relationID('b-root')],
        files: [relationID('media-b')],
      });
      assert.equal(response.status, 200);
      const data = (await response.json()) as Record<string, unknown>;
      assert.equal(data['title'], 'Posted, not secret');
      const related = data['related'] as (Record<string, unknown> | string | number)[];
      assert.equal((related[0] as Record<string, unknown>)['title'], 'a-root-de');
      assert.equal(related[1], relationID('b-root'));
      assert.equal(String((data['files'] as unknown[])[0]), id('media-b'));
      assert.equal(JSON.stringify(data).includes('b-draft-de'), false);
      assert.equal(JSON.stringify(data).includes('b-root-de'), false);
      observations['native-root-query-denial'] = {
        saved: 404,
        posted: 200,
        foreignFields: false,
        deniedPopulation: 'id',
      };
    },
  );

  await check(
    'native: draft replacement and SQLite ID types are explicit, not inferred from HTTP 200',
    async () => {
      const form = {
        id: relationID('article-a'),
        owner: 'a',
        title: 'Native unsaved',
        related: [relationID('a-leaf')],
        files: [relationID('media-a-alt')],
      };
      const draft = await native('a', id('article-a'), form);
      assert.equal(draft.status, 200);
      assert.equal(((await draft.json()) as Record<string, unknown>)['title'], 'a-draft-de');
      const populated = await native('a', id('article-a'), form, {
        draft: false,
        flattenLocales: false,
      });
      assert.equal(populated.status, 200);
      const data = (await populated.json()) as Record<string, unknown>;
      assert.equal(data['title'], form.title);
      assert.equal((data['related'] as Record<string, unknown>[])[0]!['title'], 'a-leaf-de');
      assert.equal((data['files'] as Record<string, unknown>[])[0]!['title'], 'a-alt-file-de');
      const strings = await native(
        'a',
        id('article-a'),
        { ...form, related: [id('a-leaf')] },
        { draft: false, flattenLocales: false },
      );
      assert.equal(strings.status, 200);
      assert.deepEqual(((await strings.json()) as Record<string, unknown>)['related'], [
        id('a-leaf'),
      ]);
      observations['native-data-options'] = {
        draftTrue: 'saved revision replaces input',
        draftFalseFlattenFalse: 'unsaved snapshot populated',
        sqliteNumericID: 'populated',
        sqliteStringID: 'unpopulated string',
      };
    },
  );

  const handle = createReferenceUnsavedHandler(h.reference, { define: entry.definePreview, fetch });
  for (const editor of ['a', 'b'] as const) {
    const other = editor === 'a' ? 'b' : 'a';
    const page = await h.open(identities[editor], {
      kind: 'collection',
      slug: 'articles',
      id: id(`article-${editor}`),
    });
    const post = (revision: number, data: unknown) =>
      new Request(page.url, {
        method: 'POST',
        headers: { cookie: page.cookie, origin: h.audience, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, revision, data }),
      });
    await check(
      `${editor}: two unsaved relation/upload revisions and saved-state independence`,
      async () => {
        for (const revision of [1, 2]) {
          const fields = {
            title: `${editor}-unsaved-${revision}`,
            related: [relationID(`${editor}-${revision === 1 ? 'root' : 'leaf'}`)],
            files: [relationID(`media-${editor}${revision === 1 ? '' : '-alt'}`)],
          };
          const response = await handle(post(revision, fields));
          assert.equal(response.status, 200);
          const result = (await response.json()) as {
            version: number;
            ok: boolean;
            revision: number;
            data: Record<string, unknown>;
          };
          assert.equal(result.version, 1);
          assert.equal(result.ok, true);
          assert.equal(result.revision, revision);
          assert.equal(result.data['title'], fields.title);
          assert.equal(String(result.data['id']), id(`article-${editor}`));
          assert.equal(result.data['owner'], editor);
          assert.equal(
            (result.data['related'] as Record<string, unknown>[])[0]!['title'],
            `${editor}-${revision === 1 ? 'root' : 'leaf'}-de`,
          );
          assert.equal(
            (result.data['files'] as Record<string, unknown>[])[0]!['title'],
            `${editor}${revision === 1 ? '' : '-alt'}-file-de`,
          );
          assert.equal(
            result.data['editorNotes'],
            editor === 'a' ? 'a-restricted-note' : undefined,
          );
        }
        const saved = (await (await h.data(page.request())).json()) as {
          data: Record<string, unknown>;
        };
        assert.equal(saved.data['title'], `${editor}-draft-de`);
      },
    );
    await check(`${editor}: unsaved population obeys mapped locale and depth`, async () => {
      for (const locale of ['en', 'de']) {
        for (const depth of [0, 1, 2]) {
          const scoped = await h.open(
            identities[editor],
            { kind: 'collection', slug: 'articles', id: id(`article-${editor}`) },
            locale,
            depth,
          );
          const response = await handle(
            new Request(scoped.url, {
              method: 'POST',
              headers: {
                cookie: scoped.cookie,
                origin: h.audience,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                version: 1,
                revision: 1,
                data: {
                  title: 'Depth probe',
                  related: [relationID(`${editor}-root`)],
                  files: [relationID(`media-${editor}`)],
                },
              }),
            }),
          );
          assert.equal(response.status, 200);
          const { data } = (await response.json()) as { data: Record<string, unknown> };
          const related = (data['related'] as unknown[])[0];
          const upload = (data['files'] as unknown[])[0];
          if (depth === 0) {
            assert.equal(related, relationID(`${editor}-root`));
            assert.equal(upload, relationID(`media-${editor}`));
          } else {
            assert.equal((related as Record<string, unknown>)['title'], `${editor}-root-${locale}`);
            assert.equal((upload as Record<string, unknown>)['title'], `${editor}-file-${locale}`);
            const next = (related as Record<string, unknown>)['next'];
            if (depth === 1) assert.equal(next, relationID(`${editor}-leaf`));
            else {
              assert.equal((next as Record<string, unknown>)['title'], `${editor}-leaf-${locale}`);
            }
          }
        }
      }
    });
    await check(
      `${editor}: foreign selections disclose no fields or bytes; next allowed revision recovers`,
      async () => {
        const response = await handle(
          post(3, {
            title: 'Selected foreign IDs',
            related: [relationID(`${other}-root`)],
            files: [relationID(`media-${other}`)],
          }),
        );
        assert.equal(response.status, 200);
        const result = (await response.json()) as { data: Record<string, unknown> };
        assert.equal(String((result.data['related'] as unknown[])[0]), id(`${other}-root`));
        assert.equal(String((result.data['files'] as unknown[])[0]), id(`media-${other}`));
        assert.equal(JSON.stringify(result).includes(`${other}-root-de`), false);
        assert.equal(JSON.stringify(result).includes(`${other}-file-de`), false);
        assert.equal(
          (await h.raw(`/api/media/file/${other}.txt`, identities[editor].token)).status,
          403,
        );
        const invalid = await handle(
          post(4, { title: 'Injected owner', related: [], files: [], owner: other }),
        );
        assert.equal(invalid.status, 400);
        assert.deepEqual(await invalid.json(), { version: 1, ok: false, error: 'invalid-request' });
        assert.equal(
          (
            await handle(
              post(5, { title: 'Recovered', related: [relationID(`${editor}-leaf`)], files: [] }),
            )
          ).status,
          200,
        );
      },
    );
    await check(
      `${editor}: independent root read refuses before native POST despite a valid capability`,
      async () => {
        const denied = await h.open(identities[editor], {
          kind: 'collection',
          slug: 'articles',
          id: id(`article-${other}`),
        });
        const before = fixture.requests.length;
        const response = await handle(
          new Request(denied.url, {
            method: 'POST',
            headers: {
              cookie: denied.cookie,
              origin: h.audience,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              version: 1,
              revision: 1,
              data: { title: 'Posted', related: [], files: [] },
            }),
          }),
        );
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { version: 1, ok: false, error: 'unavailable' });
        assert.equal(
          fixture.requests.slice(before).some((r) => r.method === 'POST'),
          false,
        );
      },
    );
  }
  await check('no content writes after setup or mutating REST methods', () => {
    assert.equal(fixture.writes(), 0);
    assert.equal(
      fixture.requests.some((r) => !['GET', 'POST'].includes(r.method)),
      false,
    );
    assert.equal(
      fixture.requests.filter(
        (r) =>
          r.method === 'POST' &&
          !r.path.startsWith('/api/articles/') &&
          r.path !== '/api/users/login',
      ).length,
      0,
    );
  });
  console.log(
    JSON.stringify(
      {
        cases,
        observations,
        contentWritesAfterSetup: fixture.writes(),
        requests: fixture.requests,
        serverEntrySHA256: createHash('sha256').update(readFileSync(serverPath)).digest('hex'),
        payloadVersion: (
          JSON.parse(
            readFileSync(resolve(directory, 'node_modules/payload/package.json'), 'utf8'),
          ) as { version: string }
        ).version,
      },
      null,
      2,
    ),
  );
} finally {
  await fixture.close();
}
