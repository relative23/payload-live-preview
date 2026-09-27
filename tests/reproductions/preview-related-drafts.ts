/**
 * Distinguishes saved related drafts from published relations on real Payload.
 * Characterization assertions pin the native limitation; required-contract
 * mode additionally exercises the opt-in application-side composition.
 * No package reader or Payload ACL bypass is substituted.
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

interface VersionedFixture extends ACLFixture {
  policyChanges(): number;
  setRelatedReadAccess(collection: 'records' | 'media', id: number, allowed: boolean): void;
  setRelatedFieldAccess(
    field: 'related' | 'files' | 'next',
    editor: 'a' | 'b',
    allowed: boolean,
  ): void;
}
const supplied = process.argv[2];
assert.ok(supplied, 'Pass the isolated installation directory');
const directory = realpathSync(resolve(supplied));
assert.ok(!directory.startsWith(`${process.cwd()}${sep}`));
const require = createRequire(resolve(directory, 'package.json'));
const serverPath = realpathSync(require.resolve('payload-live-preview/server'));
assert.ok(serverPath.startsWith(`${directory}${sep}`), 'No workspace package fallback');
const entry = (await import(pathToFileURL(serverPath).href)) as typeof ServerEntry;
const module = (await import(pathToFileURL(resolve(directory, 'acl-fixture.ts')).href)) as {
  startACLFixture(options: { versionedRelated: boolean }): Promise<VersionedFixture>;
};
const fixture = await module.startACLFixture({ versionedRelated: true });
const required = process.argv.includes('--require-related-drafts');
const cases: { name: string; result: string }[] = [];
const observations: Record<string, unknown> = {};
const contracts: {
  name: string;
  root: unknown;
  expectedRoot: string;
  related: unknown;
  expectedRelated: string;
  upload: unknown;
  expectedUpload: string;
}[] = [];
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
function object(value: unknown): Record<string, unknown> {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    'Expected populated object',
  );
  return value as Record<string, unknown>;
}
function first(data: Record<string, unknown>, name: string): unknown {
  assert.ok(Array.isArray(data[name]));
  return data[name][0] as unknown;
}
async function document(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const envelope = object(await response.json());
  assert.equal(envelope['version'], 1);
  assert.equal(envelope['ok'], true);
  return object(envelope['data']);
}
try {
  const h = createACLReference(fixture, entry);
  const identities = { a: await h.login('a'), b: await h.login('b') };
  const id = (key: string) => {
    const value = fixture.ids[key];
    assert.ok(value);
    return value;
  };
  const number = (key: string) => Number(id(key));
  const target = (editor: string) => ({
    kind: 'collection' as const,
    slug: 'articles',
    id: id(`article-${editor}`),
  });
  const handle = createReferenceUnsavedHandler(h.reference, { fetch, define: entry.definePreview });
  const composed = createReferenceUnsavedHandler(h.reference, {
    fetch,
    define: entry.definePreview,
    relatedDrafts: { authorizeRequest: entry.authorizePreviewRequest },
  });
  type Page = Awaited<ReturnType<typeof h.open>>;
  const form = (editor: string, revision: number) => ({
    title: `${editor}-unsaved-${revision}`,
    related: [number(`${editor}-${revision === 1 ? 'root' : 'leaf'}`)],
    files: [number(`media-${editor}${revision === 1 ? '' : '-alt'}`)],
  });
  const request = (page: Page, editor: string, revision: number) =>
    new Request(page.url, {
      method: 'POST',
      headers: { cookie: page.cookie, origin: h.audience, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, revision, data: form(editor, revision) }),
    });
  for (const editor of ['a', 'b'] as const) {
    const other = editor === 'a' ? 'b' : 'a';
    for (const locale of ['en', 'de']) {
      await check(
        `${editor}/${locale}: direct authorized reads distinguish published from saved draft`,
        async () => {
          for (const [collection, key, title] of [
            ['records', `${editor}-root`, `${editor}-root`],
            ['records', `${editor}-leaf`, `${editor}-leaf`],
            ['media', `media-${editor}`, `${editor}-file`],
            ['media', `media-${editor}-alt`, `${editor}-alt-file`],
          ]) {
            for (const draft of [false, true]) {
              const response = await h.raw(
                `/api/${collection}/${id(key!)}?depth=0&draft=${draft}&locale=${locale}`,
                identities[editor].token,
              );
              assert.equal(response.status, 200);
              const data = object(await response.json());
              assert.equal(data['title'], `${title}${draft ? '-draft' : ''}-${locale}`);
              assert.equal(data['_status'], draft ? 'draft' : 'published');
            }
          }
        },
      );
      for (const depth of [0, 1, 2]) {
        const page = await h.open(identities[editor], target(editor), locale, depth);
        await check(
          `${editor}/${locale}/depth-${depth}: two unsaved revisions retain only published population`,
          async () => {
            for (const revision of [1, 2]) {
              const data = await document(await handle(request(page, editor, revision)));
              const selected = required
                ? await document(await composed(request(page, editor, revision)))
                : data;
              const input = form(editor, revision);
              assert.deepEqual(
                { ...selected, related: undefined, files: undefined },
                { ...data, related: undefined, files: undefined },
              );
              assert.equal(data['title'], input.title);
              assert.equal(String(data['id']), id(`article-${editor}`));
              assert.equal(data['owner'], editor);
              const relation = first(data, 'related');
              const upload = first(data, 'files');
              if (depth === 0) {
                assert.equal(relation, input.related[0]);
                assert.equal(upload, input.files[0]);
                assert.deepEqual(selected, data);
              } else {
                const related = object(relation);
                const file = object(upload);
                const part = revision === 1 ? 'root' : 'leaf';
                const suffix = revision === 1 ? '' : '-alt';
                assert.equal(related['title'], `${editor}-${part}-${locale}`);
                assert.equal(file['title'], `${editor}${suffix}-file-${locale}`);
                assert.equal(related['_status'], 'published');
                assert.equal(file['_status'], 'published');
                if (revision === 1) {
                  if (depth === 1) assert.equal(related['next'], number(`${editor}-leaf`));
                  else assert.equal(object(related['next'])['title'], `${editor}-leaf-${locale}`);
                }
                contracts.push({
                  name: `${editor}/${locale}/depth-${depth}/revision-${revision}`,
                  root: selected['title'],
                  expectedRoot: input.title,
                  related: object(first(selected, 'related'))['title'],
                  expectedRelated: `${editor}-${part}-draft-${locale}`,
                  upload: object(first(selected, 'files'))['title'],
                  expectedUpload: `${editor}${suffix}-file-draft-${locale}`,
                });
                if (required && revision === 1 && depth === 2) {
                  assert.equal(
                    object(object(first(selected, 'related'))['next'])['title'],
                    `${editor}-leaf-draft-${locale}`,
                  );
                }
              }
              assert.equal(data['editorNotes'], editor === 'a' ? 'a-restricted-note' : undefined);
            }
            const saved = await document(await h.data(page.request()));
            assert.equal(saved['title'], `${editor}-draft-${locale}`);
          },
        );
      }
    }
    const page = await h.open(identities[editor], target(editor));
    await check(
      `${editor}: native draft=true selects related drafts but replaces the unsaved root`,
      async () => {
        const response = await fetch(
          `${fixture.origin}/api/articles/${id(`article-${editor}`)}?depth=2&draft=true&locale=de`,
          {
            method: 'POST',
            headers: {
              authorization: `JWT ${identities[editor].token}`,
              'content-type': 'application/json',
              'x-payload-http-method-override': 'GET',
            },
            body: JSON.stringify({
              data: { id: number(`article-${editor}`), owner: editor, ...form(editor, 2) },
              draft: true,
              flattenLocales: false,
            }),
            redirect: 'error',
            cache: 'no-store',
          },
        );
        assert.equal(response.status, 200);
        const data = object(await response.json());
        assert.deepEqual(data['title'], { en: `${editor}-draft-en`, de: `${editor}-draft-de` });
        const related = data['related'] as unknown[];
        const allowed = object(related[editor === 'a' ? 0 : 1]);
        assert.equal(allowed['title'], `${editor}-root-draft-de`);
        assert.equal(object(allowed['next'])['title'], `${editor}-leaf-draft-de`);
        assert.equal(related[editor === 'a' ? 1 : 0], number(`${other}-root`));
        const uploads = data['files'] as unknown[];
        assert.equal(object(uploads[editor === 'a' ? 0 : 1])['title'], `${editor}-file-draft-de`);
        assert.equal(uploads[editor === 'a' ? 1 : 0], number(`media-${other}`));
        observations[`${editor}-native-draft-true`] = {
          root: 'saved instead of unsaved',
          related: 'allowed saved draft',
          foreignPopulation: 'id',
        };
      },
    );
    await check(`${editor}: foreign related documents refuse in either version mode`, async () => {
      for (const draft of [false, true]) {
        for (const [collection, key] of [
          ['records', `${other}-root`],
          ['media', `media-${other}`],
        ]) {
          assert.equal(
            (
              await h.raw(
                `/api/${collection}/${id(key!)}?draft=${draft}&locale=de`,
                identities[editor].token,
              )
            ).status,
            404,
          );
        }
      }
      assert.equal(
        (await h.raw(`/api/media/file/${other}.txt`, identities[editor].token)).status,
        403,
      );
    });
    await check(
      `${editor}: revocation removes related fields and file bytes; restoring policy recovers without content writes`,
      async () => {
        fixture.setRelatedReadAccess('records', number(`${editor}-root`), false);
        fixture.setRelatedReadAccess('media', number(`media-${editor}`), false);
        try {
          for (const draft of [false, true]) {
            assert.equal(
              (
                await h.raw(
                  `/api/records/${id(`${editor}-root`)}?draft=${draft}`,
                  identities[editor].token,
                )
              ).status,
              404,
            );
            assert.equal(
              (
                await h.raw(
                  `/api/media/${id(`media-${editor}`)}?draft=${draft}`,
                  identities[editor].token,
                )
              ).status,
              404,
            );
          }
          const data = await document(await handle(request(page, editor, 1)));
          assert.equal(first(data, 'related'), number(`${editor}-root`));
          assert.equal(first(data, 'files'), number(`media-${editor}`));
          if (required) {
            const refused = await document(await composed(request(page, editor, 1)));
            assert.equal(first(refused, 'related'), number(`${editor}-root`));
            assert.equal(first(refused, 'files'), number(`media-${editor}`));
          }
          assert.equal(
            (await h.raw(`/api/media/file/${editor}.txt`, identities[editor].token)).status,
            403,
          );
          const unrelated = await h.raw(
            `/api/records/${id(`${other}-root`)}?draft=true&locale=de`,
            identities[other].token,
          );
          assert.equal(unrelated.status, 200);
          assert.equal(object(await unrelated.json())['title'], `${other}-root-draft-de`);
        } finally {
          fixture.setRelatedReadAccess('records', number(`${editor}-root`), true);
          fixture.setRelatedReadAccess('media', number(`media-${editor}`), true);
        }
        const recovered = await document(await handle(request(page, editor, 1)));
        assert.equal(object(first(recovered, 'related'))['title'], `${editor}-root-de`);
        if (required) {
          assert.equal(
            object(first(await document(await composed(request(page, editor, 1))), 'related'))[
              'title'
            ],
            `${editor}-root-draft-de`,
          );
        }
        assert.equal(
          (await h.raw(`/api/media/file/${editor}.txt`, identities[editor].token)).status,
          200,
        );
      },
    );
    await check(
      `${editor}: revocation between root ACL read and population is honored by the related ACL`,
      async () => {
        let changed = false;
        const intercepted: typeof fetch = async (url, init) => {
          assert.equal(typeof url, 'string');
          const response = await fetch(url, init);
          if (
            !changed &&
            (init?.method ?? 'GET') === 'GET' &&
            new URL(url as string).pathname === `/api/articles/${id(`article-${editor}`)}`
          ) {
            fixture.setRelatedReadAccess('records', number(`${editor}-root`), false);
            changed = true;
          }
          return response;
        };
        try {
          const read = createReferenceUnsavedHandler(h.reference, {
            define: entry.definePreview,
            fetch: intercepted,
            ...(required
              ? { relatedDrafts: { authorizeRequest: entry.authorizePreviewRequest } }
              : {}),
          });
          const data = await document(await read(request(page, editor, 1)));
          assert.equal(changed, true);
          assert.equal(first(data, 'related'), number(`${editor}-root`));
          assert.equal(
            object(first(data, 'files'))['title'],
            `${editor}-file${required ? '-draft' : ''}-de`,
          );
        } finally {
          fixture.setRelatedReadAccess('records', number(`${editor}-root`), true);
        }
      },
    );
    await check(
      `${editor}: the root capability cannot silently authorize a separate related-document read`,
      async () => {
        let calls = 0;
        const result = await h.reference.withGrant(
          page.request(),
          async ({ context, target: bound }) => {
            const preview = entry.definePreview({
              serverURL: bound.serverURL,
              depth: 0,
              fetch: () => {
                calls++;
                throw new Error('Must not fetch');
              },
            });
            const read = await preview.fetchDocument({
              authorization: context,
              collection: 'records',
              id: id(`${editor}-root`),
              locale: 'de',
            });
            assert.equal(read.ok, false);
            assert.equal(read.reason, 'scope');
            return true;
          },
        );
        assert.equal(result, true);
        assert.equal(calls, 0);
      },
    );
  }
  if (required) {
    for (const editor of ['a', 'b'] as const) {
      for (const locale of ['en', 'de']) {
        await check(
          `${editor}/${locale}: draft-only and published-only relations keep their actual status`,
          async () => {
            const page = await h.open(identities[editor], target(editor), locale, 2);
            for (const status of ['draft', 'published']) {
              const input = {
                title: 'Never saved',
                related: [number(`records-${editor}-${status}-only`)],
                files: [number(`media-${editor}-${status}-only`)],
              };
              const req = new Request(page.url, {
                method: 'POST',
                headers: {
                  cookie: page.cookie,
                  origin: h.audience,
                  'content-type': 'application/json',
                },
                body: JSON.stringify({ version: 1, revision: 3, data: input }),
              });
              const data = await document(await composed(req));
              assert.equal(data['title'], input.title);
              for (const [field, collection] of [
                ['related', 'records'],
                ['files', 'media'],
              ]) {
                const value = object(first(data, field!));
                assert.equal(value['title'], `${collection}-${editor}-${status}-only-${locale}`);
                assert.equal(value['_status'], status);
              }
            }
          },
        );
      }
      const page = await h.open(identities[editor], target(editor));
      await check(
        `${editor}: native field ACL removal never restores related or upload fields`,
        async () => {
          fixture.setRelatedFieldAccess('related', editor, false);
          fixture.setRelatedFieldAccess('files', editor, false);
          const from = fixture.requests.length;
          try {
            const data = await document(await composed(request(page, editor, 1)));
            assert.equal(Object.hasOwn(data, 'related'), false);
            assert.equal(Object.hasOwn(data, 'files'), false);
            assert.equal(
              fixture.requests.slice(from).some((r) => /^\/api\/(records|media)\//.test(r.path)),
              false,
            );
          } finally {
            fixture.setRelatedFieldAccess('related', editor, true);
            fixture.setRelatedFieldAccess('files', editor, true);
          }
        },
      );
      await check(
        `${editor}: nested field ACL removal never restores the next relation`,
        async () => {
          fixture.setRelatedFieldAccess('next', editor, false);
          const from = fixture.requests.length;
          try {
            const data = await document(await composed(request(page, editor, 1)));
            assert.equal(Object.hasOwn(object(first(data, 'related')), 'next'), false);
            assert.equal(
              fixture.requests
                .slice(from)
                .some((r) => r.path.startsWith(`/api/records/${id(`${editor}-leaf`)}?`)),
              false,
            );
          } finally {
            fixture.setRelatedFieldAccess('next', editor, true);
          }
        },
      );
    }
  }
  await check('no content writes or mutating REST methods after setup', () => {
    assert.equal(fixture.writes(), 0);
    assert.equal(fixture.policyChanges(), required ? 24 : 12);
    assert.equal(
      fixture.requests.some((r) => !['GET', 'POST'].includes(r.method)),
      false,
    );
    assert.equal(
      fixture.requests.filter(
        (r) =>
          r.method === 'POST' &&
          r.path !== '/api/users/login' &&
          !r.path.startsWith('/api/articles/'),
      ).length,
      0,
    );
  });
  if (required) {
    assert.equal(contracts.length, 16, 'Every required combination must be observed');
    for (const contract of contracts) {
      await check(`required unsaved root plus related drafts: ${contract.name}`, () => {
        assert.equal(contract.root, contract.expectedRoot);
        assert.equal(contract.related, contract.expectedRelated);
        assert.equal(contract.upload, contract.expectedUpload);
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        mode: required ? 'required-contract' : 'characterization-not-acceptance',
        requiredContract: {
          name: 'unsaved root and authorized related drafts together',
          cases: contracts.length,
          satisfied: contracts.filter(
            (c) =>
              c.root === c.expectedRoot &&
              c.related === c.expectedRelated &&
              c.upload === c.expectedUpload,
          ).length,
        },
        cases,
        observations,
        contracts,
        requests: fixture.requests,
        contentWritesAfterSetup: fixture.writes(),
        policyChanges: fixture.policyChanges(),
        policyAuthority:
          'process-local fixture access function; not a persisted revocation service',
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
