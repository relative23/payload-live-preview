import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { livePreviewAnnotate } from 'payload-live-preview/annotate';

/**
 * The schema, which a real project takes from `generateTypes().inventory` (or
 * the `--inventory` file `pll-codegen` writes). This fixture has no Payload
 * behind it, so it states the two fields `/annotated` prints.
 */
const inventory = {
  globals: [
    {
      slug: 'home',
      typeName: 'Home',
      fields: [
        { path: 'title', kind: 'scalar', localized: false, required: true },
        { path: 'subtitle', kind: 'scalar', localized: false, required: false },
      ],
    },
  ],
  collections: [],
};

// The hybrid fixture renders fragments on the server, so it is an SSR site
// with the Node adapter; `src/middleware.ts` injects the runtime with the
// fragment client and the page authorization.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4177, host: true },
  // Only `/annotated` has anything to annotate; every other page in this
  // fixture writes its bindings by hand, which is what the rest of the suite
  // measures. The include keeps the two apart in one build.
  vite: {
    plugins: [
      livePreviewAnnotate({
        inventory,
        include: (id) => id.split('?')[0]?.endsWith('/annotated.astro') === true,
      }),
    ],
  },
});
