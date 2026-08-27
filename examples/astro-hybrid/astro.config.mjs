import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// The hybrid fixture renders fragments on the server, so it is an SSR site
// with the Node adapter; `src/middleware.ts` injects the runtime with the
// fragment client and the page authorization.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4177, host: true },
});
