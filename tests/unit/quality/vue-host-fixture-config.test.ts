/**
 * The standalone Vue consumer has its own compiler, type gate and owner.
 * These structural checks supplement, but cannot replace, native SSR,
 * real browser scope disposal or the installed package's authority contracts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');
const source = (path: string): string =>
  read('tests/fixtures/vue-continuation/' + path + '.fixture');

describe('standalone Vue host fixture', () => {
  it('checks real SFC types separately before both native production builds', () => {
    const manifest = JSON.parse(read('tests/fixtures/vue-host-deps/package.json')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(manifest.scripts['typecheck']).toBe('vue-tsc --noEmit -p tsconfig.json');
    expect(manifest.scripts['build']).toContain('npm run typecheck && vite build');
    expect(manifest.scripts['build']).toContain('--ssr src/entry-server.ts');
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['payload-live-preview', 'vue']);
    expect(source('tsconfig.json')).toContain('"strict": true');
    expect(source('tsconfig.json')).toContain('"strictTemplates": true');
    expect(source('type-contracts/Negative.vue')).toContain('title.toFixed(2)');
    expect(read('tests/e2e/helpers/native-continuation.ts')).toContain("'TS2551'");
  });

  it('uses the packed composable inside a disposable real Vue scope', () => {
    const owner = source('src/Preview.vue');
    expect(owner).toContain("from 'payload-live-preview/vue'");
    expect(owner).toContain('scope = effectScope()');
    expect(owner).toContain('scope.run(');
    expect(owner).toContain('scope?.stop()');
    expect(owner).toContain('onUnmounted(stop)');
    expect(owner).toContain("eventSourcePolicy: 'parent-or-opener'");
    expect(owner).toContain('signal: init?.signal');
    expect(owner).not.toContain('NuxtLink');
    expect(owner).not.toContain('v-html');
    expect(source('src/entry-client.ts')).toContain('app.unmount()');
    expect(source('src/entry-client.ts')).toContain("window.addEventListener('pagehide'");
  });

  it('serves only recorded built assets and keeps authorization outside the SSR view', () => {
    const service = source('server.mjs');
    expect(service).toContain('createHTMLHostReference(');
    expect(service).toContain('withNativeHostRequest(incoming, url, handle)');
    expect(service).toContain('assets.get(url.pathname)');
    expect(service).toContain("process.env.PLP_VUE_HOST_ENABLED === 'local-test-only'");
    expect(service).not.toContain('readFileSync(url.pathname)');
    expect(source('src/entry-server.ts')).toContain(
      'renderToString(createSSRApp(Preview, { ...view }))',
    );
    expect(source('record-build.mjs')).toContain('require.resolve(name)');
    expect(source('record-build.mjs')).toContain("'nuxt'");
  });

  it('has a separate TLS consumer and scope-lifetime browser contract', () => {
    const config = read('playwright.vue-continuation.config.ts');
    expect(config).toContain("continuationFramework: 'vue'");
    expect(config).toContain("'vue-owner.spec.ts'");
    expect(config).toContain("from './playwright.next-continuation.config'");
    expect(read('scripts/vue-production-fixture.mjs')).toContain("runNodeProductionFixture('vue')");
  });
});
