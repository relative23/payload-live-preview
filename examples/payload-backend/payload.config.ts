import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildConfig } from 'payload';
import { sqliteAdapter } from '@payloadcms/db-sqlite';
import { lexicalEditor } from '@payloadcms/richtext-lexical';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4173';

export default buildConfig({
  secret: 'e2e-fixture-secret-not-for-production',
  admin: {
    // Auto-login the seeded editor so the Playwright E2E doesn't have to
    // type credentials (this is a throwaway fixture, never production).
    autoLogin: {
      email: 'e2e@example.com',
      password: 'test1234',
      prefillOnly: false,
    },
    livePreview: {
      // The admin shows this URL in the preview iframe; our runtime lives
      // on that page and receives the admin's postMessage updates.
      url: () => `${FRONTEND_URL}/?preview=true`,
      globals: ['homepage'],
    },
  },
  editor: lexicalEditor(),
  db: sqliteAdapter({
    client: { url: process.env.DATABASE_URI || 'file:./e2e.db' },
  }),
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  collections: [
    {
      slug: 'users',
      auth: true,
      fields: [],
    },
  ],
  globals: [
    {
      slug: 'homepage',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'subtitle', type: 'text' },
        { name: 'body', type: 'richText' },
        {
          name: 'tags',
          type: 'array',
          fields: [{ name: 'label', type: 'text' }],
        },
      ],
    },
  ],
  // Seed a throwaway editor + homepage content on first boot so the E2E
  // has something to edit immediately.
  onInit: async (payload) => {
    const existing = await payload.find({ collection: 'users', limit: 1 });
    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'users',
        data: { email: 'e2e@example.com', password: 'test1234' },
      });
    }
    await payload.updateGlobal({
      slug: 'homepage',
      data: {
        title: 'Seeded title',
        subtitle: 'Seeded subtitle',
        tags: [{ label: 'alpha' }, { label: 'beta' }],
      },
    });
  },
});
