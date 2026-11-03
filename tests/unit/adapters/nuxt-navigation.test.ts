import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Vue from 'vue';
import { NAVIGATION_COMMIT_EVENT } from '@core/navigation-lifecycle';
import { readRouteRefresh } from '@core/route-refresh';
import { bindNuxtNavigation, type NuxtNavigationApp } from '@adapters/nuxt/client';
import livePreviewModule, {
  PLUGIN_FILENAME,
  type NuxtLike,
  type NuxtPluginLike,
  type NuxtTemplateLike,
} from '@adapters/nuxt/module';
import { resetDevWarnings } from '@/types/dev-warning';

/**
 * Since 2.4 the Nuxt module registers the client plugin docs/nuxt.md had a
 * project copy: one navigation event per committed route, `refreshNuxtData()`
 * lent to the route strategy, and nothing registered beside a project's own copy.
 */

const ADMIN = 'https://admin.example.com';
const NAVIGATION_PLUGIN_FILENAME = 'payload-live-preview-navigation.client.mjs';

const order = vi.hoisted(() => [] as string[]);

vi.mock('vue', async (original) => ({
  ...(await original<typeof Vue>()),
  nextTick: async () => {
    await Promise.resolve();
    order.push('tick');
  },
}));

function fakeApp(fullPath: string): {
  app: NuxtNavigationApp;
  go: (path: string) => void;
  finish: () => void;
  hooks: () => number;
} {
  const route = { value: { fullPath } };
  const callbacks = new Set<() => void>();
  return {
    app: {
      $router: { currentRoute: route },
      hook: (_name, callback) => {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
    },
    go: (path) => {
      route.value = { fullPath: path };
    },
    finish: () => {
      for (const callback of [...callbacks]) callback();
    },
    hooks: () => callbacks.size,
  };
}

let commits: number;
const onCommit = (): void => {
  commits += 1;
};

beforeEach(() => {
  commits = 0;
  document.addEventListener(NAVIGATION_COMMIT_EVENT, onCommit);
});

afterEach(() => {
  document.removeEventListener(NAVIGATION_COMMIT_EVENT, onCommit);
  (window as unknown as Record<string, unknown>)['__livePreviewRouteRefresh'] = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetDevWarnings();
});

describe('bindNuxtNavigation', () => {
  it('dispatches once per committed route, not for the start or a repeated finish', () => {
    const nuxt = fakeApp('/a');
    const cleanup = bindNuxtNavigation(nuxt.app, () => Promise.resolve());
    nuxt.finish();
    expect(commits).toBe(0);
    nuxt.go('/a?x=1');
    nuxt.finish();
    nuxt.finish();
    expect(commits).toBe(1);
    nuxt.go('/b');
    nuxt.finish();
    expect(commits).toBe(2);
    cleanup();
  });

  it('lends a refresh that settles after the data and the next Vue tick', async () => {
    order.length = 0;
    const cleanup = bindNuxtNavigation(fakeApp('/a').app, async () => {
      await Promise.resolve();
      order.push('refreshNuxtData');
    });
    await readRouteRefresh()?.();
    order.push('settled');
    expect(order).toEqual(['refreshNuxtData', 'tick', 'settled']);
    cleanup();
  });

  it('releases both seams on an ordinary unload, once, and keeps them for a cached page', () => {
    const nuxt = fakeApp('/a');
    bindNuxtNavigation(nuxt.app, () => Promise.resolve());
    const persisted = new Event('pagehide') as PageTransitionEvent;
    Object.defineProperty(persisted, 'persisted', { value: true });
    window.dispatchEvent(persisted);
    expect(nuxt.hooks()).toBe(1);
    expect(readRouteRefresh()).toBeTypeOf('function');
    window.dispatchEvent(new Event('pagehide'));
    expect(nuxt.hooks()).toBe(0);
    expect(readRouteRefresh()).toBeUndefined();
    window.dispatchEvent(new Event('pagehide'));
    expect(nuxt.hooks()).toBe(0);
  });
});

function fakeNuxt(
  srcDir: string,
  livePreview?: NuxtLike['options']['livePreview'],
): { nuxt: NuxtLike; templates: NuxtTemplateLike[]; plugins: (NuxtPluginLike | string)[] } {
  const templates: NuxtTemplateLike[] = [];
  const plugins: (NuxtPluginLike | string)[] = [];
  return {
    templates,
    plugins,
    nuxt: {
      options: {
        rootDir: srcDir,
        srcDir,
        buildDir: join(srcDir, '.nuxt'),
        build: { templates },
        plugins,
        ...(livePreview && { livePreview }),
      },
      hook: () => undefined,
    },
  };
}

describe('the Nuxt module and its client plugin', () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'plp-nuxt-navigation-'));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it('writes the plugin into the build dir and registers it for the client, once', () => {
    const { nuxt, templates, plugins } = fakeNuxt(project);
    livePreviewModule({ allowedOrigins: [ADMIN] }, nuxt);
    livePreviewModule({ allowedOrigins: [ADMIN] }, nuxt);
    const written = templates.filter((entry) => entry.filename === NAVIGATION_PLUGIN_FILENAME);
    expect(written[0]?.write).toBe(true);
    expect(plugins).toEqual([
      { src: join(project, '.nuxt', NAVIGATION_PLUGIN_FILENAME), mode: 'client' },
    ]);
  });

  it('creates the plugin list when Nuxt hands none over', () => {
    const { nuxt } = fakeNuxt(project);
    const { plugins: _plugins, ...options } = nuxt.options;
    const bare: NuxtLike['options'] = options;
    livePreviewModule({ allowedOrigins: [ADMIN] }, { ...nuxt, options: bare });
    expect(bare.plugins).toHaveLength(1);
  });

  it('registers nothing with `navigation: false`, and keeps the switch out of the Nitro plugin', () => {
    const { nuxt, templates, plugins } = fakeNuxt(project, { navigation: false });
    livePreviewModule({ allowedOrigins: [ADMIN] }, nuxt);
    expect(plugins).toEqual([]);
    expect(templates.map((entry) => entry.filename)).toEqual([PLUGIN_FILENAME]);
    expect(templates[0]?.getContents()).not.toContain('navigation');
  });

  it('leaves a project with the recipe plugin in charge, and says so in development', () => {
    mkdirSync(join(project, 'plugins'));
    writeFileSync(join(project, 'plugins', 'payload-live-preview-navigation.client.ts'), '');
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { nuxt, templates, plugins } = fakeNuxt(project);
    livePreviewModule({ allowedOrigins: [ADMIN] }, nuxt);
    expect(plugins).toEqual([]);
    expect(templates.map((entry) => entry.filename)).toEqual([PLUGIN_FILENAME]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'plugins/payload-live-preview-navigation.client.ts',
    );
  });

  it('generates a plugin that imports Nuxt from #app and the bridge from the package', () => {
    const { nuxt, templates } = fakeNuxt(project);
    livePreviewModule({ allowedOrigins: [ADMIN] }, nuxt);
    const source =
      templates.find((entry) => entry.filename === NAVIGATION_PLUGIN_FILENAME)?.getContents() ?? '';
    expect(source).toContain("from '#app'");
    expect(source).toContain("from 'payload-live-preview/nuxt/client'");
    expect(source).toContain('bindNuxtNavigation(nuxtApp, refreshNuxtData)');
    expect(source).toContain('import.meta.hot?.dispose(cleanup)');
  });
});
