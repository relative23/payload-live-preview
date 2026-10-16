/**
 * What Nitro needs to bundle a project's single-file components for the
 * fragment endpoint (ADR 0030). Nuxt's own build hashes a component's scope id
 * from its path under `srcDir`; Vue's plugin inside Nitro's rollup sees paths
 * from the working directory. On Nuxt 4's `app/` layout the two ids differed
 * (`data-v-30b0ac3d` on the page, `data-v-523b74a5` in the fragment), so no
 * scoped rule reached what a fragment rendered. The plugin factory is the
 * app's own `@vitejs/plugin-vue`; a stand-in records what it is handed.
 */
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fragmentComponentPlugins } from '@adapters/nuxt/module';

type IdGenerator = (
  filepath: string,
  source: string,
  isProduction: boolean | undefined,
  getHash: (text: string) => string,
) => string;

function capture(): { factory: (options?: unknown) => { name: string }; options: () => unknown } {
  let handed: unknown;
  return {
    factory: (options) => {
      handed = options;
      return { name: 'vite:vue' };
    },
    options: () => handed,
  };
}

function generator(options: unknown): IdGenerator {
  const generate = (options as { features?: { componentIdGenerator?: unknown } } | undefined)
    ?.features?.componentIdGenerator;
  if (typeof generate !== 'function') throw new Error('no componentIdGenerator handed to vue()');
  return generate as IdGenerator;
}

const identity = (text: string): string => `hash(${text})`;

describe('fragmentComponentPlugins (ADR 0030)', () => {
  it('hashes a scope id from the path under srcDir, as Nuxt does — Nuxt 4 layout', () => {
    const vue = capture();
    fragmentComponentPlugins(vue.factory, { srcDir: resolve('app') });
    const id = generator(vue.options());

    // plugin-vue hands a path relative to its own root, the working directory.
    expect(id('app/components/Hero.vue', '<template/>', false, identity)).toBe(
      'hash(components/Hero.vue)',
    );
    expect(id('app/components/Hero.vue', '<template/>', true, identity)).toBe(
      'hash(components/Hero.vue<template/>)',
    );
  });

  it('leaves the default id alone on a layout whose srcDir is the project root — Nuxt 3', () => {
    const vue = capture();
    fragmentComponentPlugins(vue.factory, { srcDir: process.cwd() });

    expect(generator(vue.options())('components/Hero.vue', 's', false, identity)).toBe(
      'hash(components/Hero.vue)',
    );
  });

  it('answers every style request with an empty module, before vue() can compile it', () => {
    const vue = capture();
    const plugins = fragmentComponentPlugins(vue.factory, { srcDir: process.cwd() });
    const styles = plugins[0] as {
      name: string;
      resolveId: (id: string) => string | null;
      load: (id: string) => string | null;
    };

    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'payload-live-preview:server-styles',
      'vite:vue',
    ]);
    const resolved = styles.resolveId(
      `${join('components', 'Hero.vue')}?vue&type=style&index=0&scoped=30b0ac3d&lang.css`,
    );
    expect(resolved).not.toBeNull();
    expect(styles.load(resolved ?? '')).toBe('export default ""');
    expect(styles.resolveId('components/Hero.vue?vue&type=script&setup=true&lang.ts')).toBeNull();
    expect(styles.load('components/Hero.vue')).toBeNull();
  });
});
