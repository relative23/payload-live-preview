import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildConfig } from 'payload';
import { sqliteAdapter } from '@payloadcms/db-sqlite';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { livePreview } from 'payload-live-preview/plugin';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4173';
/** The page of the frontend that shows the homepage global; a hook or composable page has its own. */
const PREVIEW_PATH = process.env.PLP_REAL_PAYLOAD_PATH || '/';
/**
 * Origins whose pages call this REST API with the editor's session (the hook's
 * and the composable's merge): Payload answers CORS for exactly these and the
 * admin. `csrf` stays unset unless PLP_REAL_PAYLOAD_CSRF=1: any list makes Payload
 * refuse a cookie that arrives without an `Origin` header, which is how a preview
 * site's server forwards the editor's session.
 */
const SITE_ORIGINS = (process.env.PLP_REAL_PAYLOAD_ORIGINS ?? '').split(',').filter(Boolean);
const ADMIN_ORIGIN = 'http://localhost:3001';

export default buildConfig({
  secret: 'e2e-fixture-secret-not-for-production',
  ...(SITE_ORIGINS.length > 0 ? { cors: [ADMIN_ORIGIN, ...SITE_ORIGINS] } : {}),
  ...(SITE_ORIGINS.length > 0 && process.env.PLP_REAL_PAYLOAD_CSRF === '1'
    ? { csrf: [ADMIN_ORIGIN, ...SITE_ORIGINS] }
    : {}),
  admin: {
    // Auto-login the seeded editor so the Playwright E2E doesn't have to
    // type credentials (this is a throwaway fixture, never production).
    // autoLogin authenticates every request on the server and issues no
    // `payload-token` cookie, so a preview site that verifies the editor's
    // session (the `payload-session` strategy) would never receive one:
    // PLP_REAL_PAYLOAD_LOGIN=1 leaves it off and the test signs in.
    ...(process.env.PLP_REAL_PAYLOAD_LOGIN === '1'
      ? {}
      : {
          autoLogin: {
            email: 'e2e@example.com',
            password: 'test1234',
            prefillOnly: false,
          },
        }),
  },
  plugins: [
    livePreview({
      baseUrl: FRONTEND_URL,
      globals: { homepage: PREVIEW_PATH },
      breakpoints: [{ name: 'plugin-mobile', label: 'Plugin mobile', width: 390, height: 844 }],
    }),
  ],
  editor: lexicalEditor(),
  db: sqliteAdapter({
    client: { url: process.env.DATABASE_URI || 'file:./e2e.db' },
  }),
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  collections: [
    {
      slug: 'users',
      auth: true,
      // The relationship picker names a user by email, not by id.
      admin: { useAsTitle: 'email' },
      fields: [],
    },
  ],
  globals: [
    {
      slug: 'homepage',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'subtitle', type: 'text' },
        // A relationship the hook has to populate: the admin posts its id, so the
        // merge re-fetches the document from this API as the editor.
        { name: 'author', type: 'relationship', relationTo: 'users' },
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
