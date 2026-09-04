/**
 * The edge request/response path, executed rather than typed. Every built entry
 * an edge deployment can reach is loaded into a Web-only vm context and driven
 * through a preview request. The Node path is the unit and integration suites.
 */

import vm from 'node:vm';
import { edgeCases } from './edge-cases';
import { edgeGlobals, loadModule, runEdgeCases } from './edge-harness';

async function main(): Promise<void> {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('edge check needs node --experimental-vm-modules');
  }
  const context = vm.createContext(edgeGlobals());
  const modules = {
    nextjs: await loadModule(context, 'dist/adapters/nextjs/index.js'),
    sveltekit: await loadModule(context, 'dist/adapters/sveltekit/index.js'),
    astro: await loadModule(context, 'dist/adapters/astro/index.js'),
    nuxt: await loadModule(context, 'dist/adapters/nuxt/index.js'),
    server: await loadModule(context, 'dist/server.js'),
    fragment: await loadModule(context, 'dist/fragment.js'),
    payload: await loadModule(context, 'dist/payload.js'),
  };
  await runEdgeCases(await edgeCases(modules));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
