import { describe, expect, it } from 'vitest';
import livePreviewModule, {
  PLUGIN_FILENAME,
  pluginSource,
  type NitroConfigLike,
  type NuxtLike,
  type NuxtTemplateLike,
} from '@adapters/nuxt/module';
import {
  previewHeaderRules,
  withLivePreview,
  type NextConfigLike,
  type NextHeaderRule,
} from '@adapters/nextjs/config';

/**
 * Setup is the part of this package a reader meets first, and the part they
 * copy without reading. These hold what the one-line forms actually produce.
 */

const ADMIN = 'https://admin.example.com';

const BUILD_DIR = '/app/.nuxt';

function fakeNuxt(livePreview?: NuxtLike['options']['livePreview']): {
  nuxt: NuxtLike;
  nitro: NitroConfigLike;
  templates: NuxtTemplateLike[];
  run: () => void;
} {
  const nitro: NitroConfigLike = {};
  const templates: NuxtTemplateLike[] = [];
  let handler: ((config: NitroConfigLike) => void) | undefined;
  return {
    nitro,
    templates,
    run: () => handler?.(nitro),
    nuxt: {
      options: { buildDir: BUILD_DIR, build: { templates }, ...(livePreview && { livePreview }) },
      hook: (_name, fn) => {
        handler = fn;
      },
    },
  };
}

describe('the Nuxt module', () => {
  it('writes the plugin into the build dir and registers it by path, once', () => {
    const { nuxt, nitro, templates, run } = fakeNuxt();

    livePreviewModule({ allowedOrigins: [ADMIN] }, nuxt);
    run();
    // A second registration (Nuxt re-runs modules on config reload) must not
    // add the plugin twice, or the runtime would be injected twice per page.
    livePreviewModule({ allowedOrigins: [ADMIN] }, nuxt);
    run();

    expect(nitro.plugins).toEqual([`${BUILD_DIR}/${PLUGIN_FILENAME}`]);
    // Nitro reads a plugin from disk; Nuxt's virtual file system is not enough.
    expect(templates[0]?.write).toBe(true);
    expect(templates[0]?.getContents()).toBe(pluginSource({ allowedOrigins: [ADMIN] }));
  });

  it('takes options from the config key, with the inline ones winning', () => {
    const { nuxt, templates } = fakeNuxt({ allowedOrigins: [ADMIN], debug: true });

    livePreviewModule({ debug: false }, nuxt);

    expect(templates[0]?.getContents()).toBe(
      pluginSource({ allowedOrigins: [ADMIN], debug: false }),
    );
  });

  it('generates the setup a reader would otherwise have written by hand', () => {
    // The module runs at build time, the plugin per request in Nitro's bundle:
    // a closure cannot cross that, so the options travel as source. What they
    // travel into is the public entry, so the generated file stays readable.
    const source = pluginSource({ allowedOrigins: [ADMIN], debounceMs: 25 });

    expect(source).toBe(
      "import { livePreviewNitroPlugin } from 'payload-live-preview/nuxt';\n\n" +
        `export default livePreviewNitroPlugin({"allowedOrigins":["${ADMIN}"],"debounceMs":25});\n`,
    );
  });

  it('names itself the way Nuxt reports modules', () => {
    expect(livePreviewModule.meta).toEqual({
      name: 'payload-live-preview',
      configKey: 'livePreview',
    });
  });
});
describe('withLivePreview for Next.js', () => {
  const base: NextConfigLike = { reactStrictMode: true };

  it('keeps the rest of the config untouched', async () => {
    const config = withLivePreview(base, { allowedOrigins: [ADMIN] });

    expect(config['reactStrictMode']).toBe(true);
    expect(await config.headers?.()).toHaveLength(3);
  });

  /**
   * Measured against Next.js 16.3.4, `next build` + `next start`: a site whose
   * own rule sends `frame-ancestors 'none'` answered a bare, unauthenticated
   * `/?preview=true` with `frame-ancestors 'self' https://admin.example.com`
   * — one header, not two. Next collects every matching rule into one object
   * keyed by header name (`resHeaders[key] = value`; only `set-cookie` is
   * pushed) and applies it with `setHeader`, and this package's rules are
   * appended after the consumer's, so the last write wins. A CSP written here
   * would therefore not widen `frame-ancestors` — it would drop the site's
   * whole policy, `script-src` and all, for anyone who appends the query
   * parameter. A config rule cannot run `authorizePreview`, so it cannot be
   * the place that decides: CSP belongs to the middleware, where the policy
   * engine has both intent and a verdict (ADR 0006 §5, F-09).
   */
  it('writes no Content-Security-Policy, which a config rule could only clobber', async () => {
    const rules = (await withLivePreview(base, { allowedOrigins: [ADMIN] }).headers?.()) ?? [];

    expect(rules).not.toHaveLength(0);
    for (const rule of rules) {
      const keys = rule.headers.map((header) => header.key.toLowerCase());
      expect(keys).not.toContain('content-security-policy');
    }
  });

  it('marks an intent-bearing request uncacheable, which restricts and grants nothing', async () => {
    const rules = (await withLivePreview(base, { allowedOrigins: [ADMIN] }).headers?.()) ?? [];

    for (const rule of rules) {
      expect(rule.has?.[0]?.type).toBe('query');
      // A preview response is one visitor's unsaved state.
      expect(rule.headers).toEqual([{ key: 'Cache-Control', value: 'private, no-store' }]);
    }
    expect(rules.map((rule) => rule.has?.[0]?.key)).toEqual(['preview', 'draft', 'livePreview']);
  });

  it('adds the admin host to allowedDevOrigins, without duplicating what is there', () => {
    const config = withLivePreview(
      { allowedDevOrigins: ['admin.example.com', 'other.example.com'] },
      { allowedOrigins: [ADMIN] },
    );

    expect(config.allowedDevOrigins).toEqual(['admin.example.com', 'other.example.com']);
  });

  it('appends to an existing headers() instead of replacing it', async () => {
    const existing: NextHeaderRule = {
      source: '/(.*)',
      headers: [{ key: 'X-Frame-Options', value: 'DENY' }],
    };

    const config = withLivePreview({ headers: () => [existing] }, { allowedOrigins: [ADMIN] });

    const rules = (await config.headers?.()) ?? [];
    expect(rules[0]).toBe(existing);
    expect(rules).toHaveLength(4);
  });

  it('refuses an empty origin list, which would leave nothing to configure', () => {
    expect(() => withLivePreview(base, { allowedOrigins: [] })).toThrow(
      /at least one admin origin/u,
    );
  });

  it('lets the intent parameters be narrowed', () => {
    const rules = previewHeaderRules({ allowedOrigins: [ADMIN], previewQueryParams: ['preview'] });

    expect(rules).toHaveLength(1);
    expect(rules[0]?.has?.[0]?.key).toBe('preview');
  });
});
