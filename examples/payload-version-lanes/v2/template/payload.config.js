/**
 * This throwaway Payload 2 admin consumes the candidate config plugin. All
 * client-visible settings are public loopback URLs; credentials stay in the
 * server's private run file, outside the admin config Webpack compiles.
 */
const { buildConfig } = require('payload/config');
const { webpackBundler } = require('@payloadcms/bundler-webpack');
const { mongooseAdapter } = require('@payloadcms/db-mongodb');
const { lexicalEditor } = require('@payloadcms/richtext-lexical');
const { livePreview } = require('payload-live-preview/plugin');

const admin = process.env.PAYLOAD_PUBLIC_P2_ADMIN_ORIGIN;
const site = process.env.PAYLOAD_PUBLIC_P2_SITE_ORIGIN;
const variant = process.env.PAYLOAD_PUBLIC_P2_VARIANT;
if (!['frontend-only', 'server-url'].includes(variant))
  throw new Error('Unexpected Payload 2 fixture variant');
const surface = process.env.PAYLOAD_PUBLIC_P2_SURFACE ?? 'dom';
if (!['dom', 'react', 'vue'].includes(surface)) throw new Error('Unexpected native surface');
const authenticated = ({ req }) => Boolean(req.user);

module.exports = buildConfig({
  // Payload 2 appends any serverURL to csrf; omit it for the frontend-only regression.
  ...(variant === 'server-url' ? { serverURL: admin } : {}),
  telemetry: false,
  graphQL: { disable: true },
  admin: {
    user: 'users',
    bundler: webpackBundler(),
    disable: false,
  },
  cors: [admin, site],
  csrf: [site],
  db: mongooseAdapter({ url: process.env.PLP_P2_MONGO_URL, transactionOptions: false }),
  editor: lexicalEditor({}),
  plugins: [
    livePreview({
      baseUrl: site,
      globals:
        surface === 'dom'
          ? { homepage: '/' }
          : {
              homepage: '/' + surface + '?document=homepage',
              otherpage: '/' + surface + '?document=otherpage',
            },
      breakpoints: [{ name: 'p2-mobile', label: 'Payload 2 mobile', width: 390, height: 844 }],
    }),
  ],
  collections: [
    {
      slug: 'users',
      // The shipped 2.32 login success handler navigates only when its response has a token.
      auth: true,
      admin: { useAsTitle: 'email' },
      access: {
        read: authenticated,
        create: authenticated,
        update: authenticated,
        delete: authenticated,
      },
      fields: [],
    },
    {
      slug: 'authors',
      admin: { useAsTitle: 'name' },
      access: {
        read: authenticated,
        create: authenticated,
        update: authenticated,
        delete: authenticated,
      },
      fields: [{ name: 'name', type: 'text', required: true }],
    },
  ],
  globals: (surface === 'dom' ? ['homepage'] : ['homepage', 'otherpage']).map((slug) => ({
    slug,
    access: { read: authenticated, update: authenticated },
    fields: [
      { name: 'title', type: 'text' },
      { name: 'subtitle', type: 'text' },
      { name: 'author', type: 'relationship', relationTo: 'authors' },
      { name: 'body', type: 'richText' },
      { name: 'tags', type: 'array', fields: [{ name: 'label', type: 'text' }] },
    ],
  })),
});
