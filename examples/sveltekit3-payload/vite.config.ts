import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      // adapter-node no longer reads ORIGIN at run time. The production fixture sets it for the
      // build, behind its TLS front door; `vite dev` leaves it unset and derives the origin.
      paths: { origin: process.env['ORIGIN'] },
    }),
  ],
});
