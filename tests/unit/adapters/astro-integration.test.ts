import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { livePreview } from '@adapters/astro/index';

/** The integration's inline and middleware modes through fake Astro hooks; loader mode has its own file. */

const ADMIN = 'https://admin.example.com';

function injectedConfig(script: string): unknown[] {
  const match = /var __LIVE_PREVIEW_CONFIG__=(\[[^;]*\]);/.exec(script);
  if (match?.[1] === undefined) throw new Error('injected config missing');
  const evaluated = runInNewContext(match[1], {}) as unknown;
  if (!Array.isArray(evaluated)) throw new Error('injected config is not an array');
  return evaluated;
}

describe('livePreview integration — inline mode', () => {
  it('returns an integration with the expected name', () => {
    expect(livePreview().name).toBe('payload-live-preview');
  });

  it('injects the script via head-inline by default', () => {
    const injectScript = vi.fn();
    livePreview({ defaults: 'v1', allowedOrigins: [ADMIN] }).hooks['astro:config:setup']({
      injectScript,
    });
    expect(injectScript).toHaveBeenCalledOnce();
    const [stage, script] = injectScript.mock.calls[0] as [string, string];
    expect(stage).toBe('head-inline');
    expect(script).toContain('admin.example.com');
    expect(injectedConfig(script)[25]).toEqual(['astro:page-load']);
  });

  it('honours autoInject: false', () => {
    const injectScript = vi.fn();
    livePreview({ defaults: 'v1', autoInject: false }).hooks['astro:config:setup']({
      injectScript,
    });
    expect(injectScript).not.toHaveBeenCalled();
  });

  it('forwards debounce, heartbeat, and debug options into the injected script', () => {
    const injectScript = vi.fn();
    livePreview({ defaults: 'v1', debug: true, debounceMs: 250, heartbeatMs: 60_000 }).hooks[
      'astro:config:setup'
    ]({ injectScript });
    const config = injectedConfig(injectScript.mock.calls[0]![1] as string);
    expect(config[4]).toBe(true);
    expect(config[5]).toBe(250);
    expect(config[7]).toBe(60_000);
  });

  it('forwards skipUnchanged into the trailing wire slot', () => {
    const injectScript = vi.fn();
    livePreview({ defaults: 'v1', skipUnchanged: true }).hooks['astro:config:setup']({
      injectScript,
    });
    expect(injectedConfig(injectScript.mock.calls[0]![1] as string)[14]).toBe(true);
  });

  it('refuses serverURL without an explicit mergeDepth, as the middleware does', () => {
    // Loader mode needs an updateConfig-capable context, or its own guard fires first.
    const hook = (options: Parameters<typeof livePreview>[0]) => () => {
      livePreview(options).hooks['astro:config:setup']({
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });
    };
    expect(hook({ serverURL: 'https://cms.example.com' })).toThrow(/mergeDepth/u);
    expect(hook({ mode: 'loader', serverURL: 'https://cms.example.com' })).toThrow(/mergeDepth/u);
    expect(hook({ serverURL: 'https://cms.example.com', mergeDepth: 0 })).not.toThrow();
    expect(hook({ defaults: 'v1', serverURL: 'https://cms.example.com' })).not.toThrow();
  });
});

describe('livePreview integration — middleware mode', () => {
  function makeSetupContext() {
    const injectScript = vi.fn();
    const addMiddleware = vi.fn();
    const plugins: {
      name: string;
      resolveId?: (id: string) => string | undefined;
      load?: (id: string) => string | undefined;
    }[] = [];
    const updateConfig = vi.fn((config: { vite?: { plugins?: typeof plugins } }) => {
      plugins.push(...(config.vite?.plugins ?? []));
    });
    return { injectScript, addMiddleware, updateConfig, plugins };
  }

  it('registers the middleware entrypoint and serves options via the virtual module', () => {
    const ctx = makeSetupContext();
    livePreview({
      defaults: 'v1',
      mode: 'middleware',
      allowedOrigins: [ADMIN],
      serverURL: ADMIN,
    }).hooks['astro:config:setup'](ctx);

    expect(ctx.injectScript).not.toHaveBeenCalled();
    expect(ctx.addMiddleware).toHaveBeenCalledWith({
      entrypoint: 'payload-live-preview/astro/middleware-entry',
      order: 'pre',
    });

    const plugin = ctx.plugins[0]!;
    const resolved = plugin.resolveId!('virtual:payload-live-preview/options')!;
    const moduleSource = plugin.load!(resolved)!;
    expect(moduleSource).toContain(ADMIN);
    expect(moduleSource).toMatch(/^export default \{/);
    expect(moduleSource).not.toContain('"mode"');
  });

  it('rejects shouldInject in middleware mode (not serializable)', () => {
    const integration = livePreview({
      defaults: 'v1',
      mode: 'middleware',
      shouldInject: () => true,
    });
    expect(() => {
      integration.hooks['astro:config:setup'](makeSetupContext());
    }).toThrow(/shouldInject/);
  });

  it('escapes </script>-breaking sequences in the serialized options', () => {
    const ctx = makeSetupContext();
    livePreview({
      defaults: 'v1',
      mode: 'middleware',
      previewQueryParams: ['x</script><script>'],
    }).hooks['astro:config:setup'](ctx);
    const plugin = ctx.plugins[0]!;
    const source = plugin.load!(plugin.resolveId!('virtual:payload-live-preview/options')!)!;
    expect(source).not.toContain('</script>');
  });

  it("fails fast for mode:'middleware' under the strict default, naming the resolutions", () => {
    const ctx = makeSetupContext();
    const integration = livePreview({ mode: 'middleware', allowedOrigins: [ADMIN] });
    expect(() => {
      integration.hooks['astro:config:setup'](ctx);
    }).toThrow(
      /strict default[\s\S]*Name the module that exports it in `authorizePreviewModule` \(ADR 0024\), or register `createLivePreviewMiddleware\(\{ authorizePreview, \.\.\. \}\)` yourself in src\/middleware\.ts\. `defaults: 'v1'` \(or `strict: false`\) runs intent-only middleware instead/u,
    );
    expect(ctx.addMiddleware).not.toHaveBeenCalled();
  });

  it("allows mode:'middleware' with strict: false (intent-only opt-out)", () => {
    const ctx = makeSetupContext();
    const integration = livePreview({ mode: 'middleware', strict: false, allowedOrigins: [ADMIN] });
    expect(() => {
      integration.hooks['astro:config:setup'](ctx);
    }).not.toThrow();
    expect(ctx.addMiddleware).toHaveBeenCalled();
  });

  // ADR 0024: the hook travels by reference, so the one-line setup can stay strict.
  function optionsModule(options: Parameters<typeof livePreview>[0]): string {
    const ctx = makeSetupContext();
    livePreview({ mode: 'middleware', allowedOrigins: [ADMIN], ...options }).hooks[
      'astro:config:setup'
    ](ctx);
    const plugin = ctx.plugins[0]!;
    return plugin.load!(plugin.resolveId!('virtual:payload-live-preview/options')!)!;
  }

  it('imports the hook named by authorizePreviewModule and meets the strict default with it', () => {
    const source = optionsModule({ authorizePreviewModule: './src/live-preview/authorize.ts' });
    expect(source).toContain('import authorizePreview from "/src/live-preview/authorize.ts";');
    expect(source).toContain('authorizePreview');
    expect(source).not.toContain('"authorizePreviewModule"');
    expect(source).toMatch(/typeof authorizePreview !== "function"/u);
  });

  it('passes a package or alias specifier to the bundler unchanged, escaped as the options are', () => {
    expect(optionsModule({ authorizePreviewModule: '@acme/preview-auth' })).toContain(
      'import authorizePreview from "@acme/preview-auth";',
    );
    expect(optionsModule({ authorizePreviewModule: '@acme/x</script>' })).toContain(
      'import authorizePreview from "@acme/x\\u003C/script>";',
    );
  });

  it('refuses a reference outside the project, and one outside middleware mode', () => {
    expect(() => optionsModule({ authorizePreviewModule: '../shared/authorize.ts' })).toThrow(
      /outside the project/u,
    );
    expect(() => {
      livePreview({ authorizePreviewModule: './src/authorize.ts' }).hooks['astro:config:setup']({
        injectScript: vi.fn(),
      });
    }).toThrow(
      "payload-live-preview: `authorizePreviewModule` applies to mode 'middleware'; " +
        'inline and loader delivery run no server hook (ADR 0024).',
    );
  });

  it('refuses the hook itself and the reference together', () => {
    expect(() =>
      optionsModule({ authorizePreviewModule: './src/authorize.ts', authorizePreview: () => null }),
    ).toThrow(/authorizePreview/u);
  });
});
