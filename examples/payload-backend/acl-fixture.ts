/**
 * Isolated database and real REST/authentication surface for the ACL probe.
 * Only setup uses privileged Local API writes; every measured read goes through
 * Payload's normal REST access controls, including relationship population.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { buildConfig, getPayload, handleEndpoints, type Access, type Field } from 'payload';
import { sqliteAdapter } from '@payloadcms/db-sqlite';

export async function startACLFixture(options: { versionedRelated?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'plp-payload-acl-'));
  const key = `acl-${randomUUID()}`;
  let measuredWrites = 0;
  let sealed = false;
  const requests: { path: string; method: string; status: number }[] = [];
  const owned: Access = ({ req }) => (req.user ? { owner: { equals: req.user['editor'] } } : false);
  const revoked = { records: new Set<number>(), media: new Set<number>() };
  const hiddenFields = new Set<string>();
  const fieldAccess =
    (field: string) =>
    ({ req }: { req: { user: Record<string, unknown> | null } }) =>
      !hiddenFields.has(`${field}/${String(req.user?.['editor'])}`);
  let policyChanges = 0;
  const relatedAccess =
    (slug: 'records' | 'media'): Access =>
    ({ req }) => {
      if (!req.user) return false;
      const ownerFilter = { owner: { equals: req.user['editor'] } };
      return revoked[slug].size === 0
        ? ownerFilter
        : { and: [ownerFilter, { id: { not_in: Array.from(revoked[slug]) } }] };
    };
  const deny = () => false;
  const owner: Field = { name: 'owner', type: 'text', required: true };
  const localizedTitle: Field = { name: 'title', type: 'text', localized: true, required: true };
  const written = () => {
    if (sealed) measuredWrites++;
  };
  const config = await buildConfig({
    secret: randomBytes(48).toString('base64url'),
    admin: { disable: true },
    telemetry: false,
    logger: { options: { level: 'silent' } },
    typescript: { autoGenerate: false },
    localization: { locales: ['en', 'de'], defaultLocale: 'en', fallback: false },
    db: sqliteAdapter({ client: { url: `file:${join(directory, 'acl.db')}` }, push: true }),
    collections: [
      {
        slug: 'users',
        auth: { useSessions: true, tokenExpiration: 300 },
        access: {
          read: ({ req }) => (req.user ? { id: { equals: req.user.id } } : false),
          create: deny,
          update: deny,
          delete: deny,
        },
        fields: [{ name: 'editor', type: 'select', options: ['a', 'b'], required: true }],
      },
      {
        slug: 'records',
        access: { read: relatedAccess('records'), create: deny, update: deny, delete: deny },
        ...(options.versionedRelated ? { versions: { drafts: true } } : {}),
        fields: [
          owner,
          localizedTitle,
          {
            name: 'next',
            type: 'relationship',
            relationTo: 'records',
            access: { read: fieldAccess('next') },
          },
        ],
        hooks: { afterChange: [written] },
      },
      {
        slug: 'media',
        access: { read: relatedAccess('media'), create: deny, update: deny, delete: deny },
        ...(options.versionedRelated ? { versions: { drafts: true } } : {}),
        upload: { staticDir: join(directory, 'uploads'), mimeTypes: ['text/plain'] },
        fields: [owner, localizedTitle],
        hooks: { afterChange: [written] },
      },
      {
        slug: 'articles',
        access: { read: owned, create: deny, update: deny, delete: deny },
        versions: { drafts: true },
        fields: [
          owner,
          localizedTitle,
          {
            name: 'related',
            type: 'relationship',
            relationTo: 'records',
            hasMany: true,
            access: { read: fieldAccess('related') },
          },
          {
            name: 'files',
            type: 'upload',
            relationTo: 'media',
            hasMany: true,
            access: { read: fieldAccess('files') },
          },
          {
            name: 'editorNotes',
            type: 'text',
            access: { read: ({ req }) => req.user?.['editor'] === 'a' },
          },
        ],
        hooks: { afterChange: [written] },
      },
    ],
    globals: [
      {
        slug: 'diagnostics',
        access: { read: ({ req }) => Boolean(req.user), update: deny },
        fields: [{ name: 'errors', type: 'text', defaultValue: 'Editorial diagnostics default' }],
        hooks: { afterChange: [written] },
      },
      {
        slug: 'settings',
        access: { read: ({ req }) => Boolean(req.user), update: deny },
        fields: [
          localizedTitle,
          { name: 'errors', type: 'json' },
          { name: 'related', type: 'relationship', relationTo: 'records', hasMany: true },
          { name: 'files', type: 'upload', relationTo: 'media', hasMany: true },
        ],
        hooks: { afterChange: [written] },
      },
      {
        slug: 'restricted',
        access: { read: ({ req }) => req.user?.['editor'] === 'a', update: deny },
        fields: [localizedTitle],
        hooks: { afterChange: [written] },
      },
    ],
  });
  const payload = await getPayload({ config, key });
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const password = randomBytes(32).toString('base64url');
    const ids: Record<string, string | number> = {};
    for (const editor of ['a', 'b']) {
      const user = await payload.create({
        collection: 'users',
        overrideAccess: true,
        data: { email: `${editor}@fixture.invalid`, password, editor },
      });
      ids[`user-${editor}`] = user.id;
      for (const part of ['leaf', 'root']) {
        const record = await payload.create({
          collection: 'records',
          overrideAccess: true,
          data: {
            owner: editor,
            title: `${editor}-${part}-en`,
            ...(options.versionedRelated ? { _status: 'published' } : {}),
            ...(part === 'root' ? { next: ids[`${editor}-leaf`] } : {}),
          },
        });
        ids[`${editor}-${part}`] = record.id;
        await payload.update({
          collection: 'records',
          id: record.id,
          overrideAccess: true,
          locale: 'de',
          data: {
            title: `${editor}-${part}-de`,
            ...(options.versionedRelated ? { _status: 'published' } : {}),
          },
        });
      }
      for (const suffix of ['', '-alt']) {
        const bytes = Buffer.from(`${editor}${suffix}-private-file-content`);
        const media = await payload.create({
          collection: 'media',
          overrideAccess: true,
          data: {
            owner: editor,
            title: `${editor}${suffix}-file-en`,
            ...(options.versionedRelated ? { _status: 'published' } : {}),
          },
          file: {
            data: bytes,
            name: `${editor}${suffix}.txt`,
            mimetype: 'text/plain',
            size: bytes.length,
          },
        });
        ids[`media-${editor}${suffix}`] = media.id;
        await payload.update({
          collection: 'media',
          id: media.id,
          overrideAccess: true,
          locale: 'de',
          data: {
            title: `${editor}${suffix}-file-de`,
            ...(options.versionedRelated ? { _status: 'published' } : {}),
          },
        });
      }
    }
    for (const editor of ['a', 'b']) {
      const article = await payload.create({
        collection: 'articles',
        overrideAccess: true,
        draft: true,
        data: {
          owner: editor,
          title: `${editor}-draft-en`,
          related: [ids['a-root'], ids['b-root']],
          files: [ids['media-a'], ids['media-b']],
          editorNotes: `${editor}-restricted-note`,
        },
      });
      ids[`article-${editor}`] = article.id;
      await payload.update({
        collection: 'articles',
        id: article.id,
        overrideAccess: true,
        draft: true,
        locale: 'de',
        data: { title: `${editor}-draft-de` },
      });
    }
    await payload.updateGlobal({
      slug: 'settings',
      overrideAccess: true,
      data: {
        title: 'settings-en',
        errors: [{ message: 'Legitimate editorial field' }],
        related: [ids['a-root'], ids['b-root']],
        files: [ids['media-a'], ids['media-b']],
      },
    });
    await payload.updateGlobal({
      slug: 'settings',
      overrideAccess: true,
      locale: 'de',
      data: { title: 'settings-de' },
    });
    await payload.updateGlobal({
      slug: 'restricted',
      overrideAccess: true,
      data: { title: 'a-only-global' },
    });
    if (options.versionedRelated) {
      // Both versions are seeded before measurement. The read tests never
      // save the preview form or create a new related-document version.
      for (const editor of ['a', 'b']) {
        for (const locale of ['en', 'de']) {
          for (const part of ['root', 'leaf']) {
            await payload.update({
              collection: 'records',
              id: ids[`${editor}-${part}`]!,
              overrideAccess: true,
              draft: true,
              locale,
              data: { title: `${editor}-${part}-draft-${locale}`, _status: 'draft' },
            });
          }
          for (const suffix of ['', '-alt']) {
            await payload.update({
              collection: 'media',
              id: ids[`media-${editor}${suffix}`]!,
              overrideAccess: true,
              draft: true,
              locale,
              data: { title: `${editor}${suffix}-file-draft-${locale}`, _status: 'draft' },
            });
          }
        }
      }
    }
    if (options.versionedRelated) {
      for (const editor of ['a', 'b']) {
        for (const status of ['draft', 'published'] as const) {
          for (const collection of ['records', 'media']) {
            const name = `${editor}-${status}-only`;
            const value = await payload.create({
              collection,
              overrideAccess: true,
              draft: status === 'draft',
              data: { owner: editor, title: `${collection}-${name}-en`, _status: status },
              ...(collection === 'media'
                ? {
                    file: {
                      data: Buffer.from(name),
                      name: `${name}.txt`,
                      mimetype: 'text/plain',
                      size: Buffer.byteLength(name),
                    },
                  }
                : {}),
            });
            ids[`${collection}-${name}`] = value.id;
            await payload.update({
              collection,
              id: value.id,
              overrideAccess: true,
              draft: status === 'draft',
              locale: 'de',
              data: { title: `${collection}-${name}-de`, _status: status },
            });
          }
        }
      }
    }
    sealed = true;

    const listener = createServer((incoming, outgoing) => {
      void (async () => {
        // No client-supplied Host can change the fixture's API origin.
        const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const method = incoming.method ?? 'GET';
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of incoming) {
          length += Buffer.byteLength(chunk);
          if (length > 8192) throw new Error('Fixture request exceeds setup limit');
          chunks.push(Buffer.from(chunk));
        }
        const response = await handleEndpoints({
          config,
          payloadInstanceCacheKey: key,
          request: new Request(url, {
            method,
            headers,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
          }),
        });
        requests.push({ path: `${url.pathname}${url.search}`, method, status: response.status });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        // Node and DOM declare the same native stream with distinct TS types.
        if (response.body) {
          await pipeline(
            Readable.fromWeb(response.body as unknown as NodeReadableStream),
            outgoing,
          );
        } else outgoing.end();
      })().catch(() => {
        outgoing.writeHead(500);
        outgoing.end();
      });
    });
    server = listener;
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    if (address === null || typeof address === 'string') throw new Error('No fixture listener');
    return {
      origin: `http://127.0.0.1:${address.port}`,
      ids: Object.fromEntries(Object.entries(ids).map(([name, value]) => [name, String(value)])),
      requests,
      password,
      writes: () => measuredWrites,
      policyChanges: () => policyChanges,
      setRelatedFieldAccess(
        field: 'related' | 'files' | 'next',
        editor: 'a' | 'b',
        allowed: boolean,
      ) {
        if (!options.versionedRelated || !sealed) throw new Error('Invalid fixture policy change');
        const key = `${field}/${editor}`;
        if (allowed) hiddenFields.delete(key);
        else hiddenFields.add(key);
        policyChanges++;
      },
      setRelatedReadAccess(collection: 'records' | 'media', id: number, allowed: boolean) {
        if (!options.versionedRelated || !sealed || !Number.isSafeInteger(id) || id < 1) {
          throw new Error('Invalid fixture policy change');
        }
        // Process-local policy authority, not an HTTP endpoint or content edit.
        if (allowed) revoked[collection].delete(id);
        else revoked[collection].add(id);
        policyChanges++;
      },
      async close() {
        listener.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          listener.close((error) => (error ? reject(error) : resolve())),
        );
        await payload.destroy();
        // This exact directory was created above; no existing fixture is removed.
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    server?.closeAllConnections();
    server?.close();
    await payload.destroy();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
