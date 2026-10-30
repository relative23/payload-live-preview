/**
 * The standalone React consumer has its own compiler, type gate and owner.
 * These structural checks supplement, but cannot replace, native SSR,
 * a real browser unmount or the installed package's authority contracts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');
const source = (path: string): string =>
  read('tests/fixtures/react-continuation/' + path + '.fixture');

describe('standalone React host fixture', () => {
  it('checks real component types separately before both native production builds', () => {
    const manifest = JSON.parse(read('tests/fixtures/react-host-deps/package.json')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(manifest.scripts['typecheck']).toBe('tsc --noEmit -p tsconfig.json');
    expect(manifest.scripts['build']).toContain('npm run typecheck && vite build');
    expect(manifest.scripts['build']).toContain('--ssr src/entry-server.tsx');
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      'payload-live-preview',
      'react',
      'react-dom',
    ]);
    expect(source('tsconfig.json')).toContain('"strict": true');
    expect(source('tsconfig.json')).toContain('"jsx": "react-jsx"');
    expect(source('type-contracts/Negative.tsx')).toContain('title.toFixed(2)');
    expect(read('tests/e2e/helpers/native-continuation.ts')).toContain(
      "const extension = isVue ? 'vue' : 'tsx';",
    );
  });

  it('calls the packed hook in a session component the page can unmount and replace', () => {
    const owner = source('src/Preview.tsx');
    expect(owner).toContain("from 'payload-live-preview/react'");
    expect(owner).toContain('useLivePreviewDocument<PreviewDocument>(');
    expect(owner).toContain(
      '{active ? <Session key={generation} view={view} onSnapshot={setSnapshot} /> : null}',
    );
    expect(owner).toContain("eventSourcePolicy: 'parent-or-opener'");
    expect(owner).toContain('signal: init?.signal');
    expect(owner).not.toContain('dangerouslySetInnerHTML');
    expect(source('src/entry-client.tsx')).toContain('root.unmount()');
    expect(source('src/entry-client.tsx')).toContain("window.addEventListener('pagehide'");
  });

  it('serves only recorded built assets and keeps authorization outside the SSR view', () => {
    const service = source('server.mjs');
    expect(service).toContain('createHTMLHostReference(');
    expect(service).toContain('withNativeHostRequest(incoming, url, handle)');
    expect(service).toContain('assets.get(url.pathname)');
    expect(service).toContain("process.env.PLP_REACT_HOST_ENABLED === 'local-test-only'");
    expect(service).not.toContain('readFileSync(url.pathname)');
    expect(source('src/entry-server.tsx')).toContain('renderToString(<Preview {...view} />)');
    expect(source('record-build.mjs')).toContain('require.resolve(name)');
    expect(source('record-build.mjs')).toContain("'vue'");
  });

  it('has a separate TLS consumer and unmount browser contract', () => {
    const config = read('playwright.react-continuation.config.ts');
    expect(config).toContain("continuationFramework: 'react'");
    expect(config).toContain("'react-owner.spec.ts'");
    expect(config).toContain("from './playwright.next-continuation.config'");
    expect(read('scripts/react-production-fixture.mjs')).toContain(
      "runNodeProductionFixture('react')",
    );
  });
});
