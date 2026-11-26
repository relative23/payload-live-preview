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

// `authorizePreview` and `shouldInject` left the integration's options type in 3.0 (ADR 0007,
// row 24). A JavaScript config can still pass them, and that is what the cases below hand over.
type AstroOptions = NonNullable<Parameters<typeof livePreview>[0]>;
const untyped = (
  options: AstroOptions & { authorizePreview?: unknown; shouldInject?: unknown },
): AstroOptions => options;

describe('livePreview integration — inline mode', () => {
  it('returns an integration with the expected name', () => {
    expect(livePreview().name).toBe('payload-live-preview');
  });

  it('injects the script via head-inline by default', () => {
    const injectScript = vi.fn();
    livePreview({ allowedOrigins: [ADMIN] }).hooks['astro:config:setup']({
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
    livePreview({ autoInject: false }).hooks['astro:config:setup']({
      injectScript,
    });
    expect(injectScript).not.toHaveBeenCalled();
  });

  it('forwards debounce, heartbeat, and debug options into the injected script', () => {
    const injectScript = vi.fn();
    livePreview({ debug: true, debounceMs: 250, heartbeatMs: 60_000 }).hooks['astro:config:setup']({
      injectScript,
    });
    const config = injectedConfig(injectScript.mock.calls[0]![1] as string);
    expect(config[4]).toBe(true);
    expect(config[5]).toBe(250);
    expect(config[7]).toBe(60_000);
  });

  it('forwards skipUnchanged into the trailing wire slot', () => {
    const injectScript = vi.fn();
    livePreview({ skipUnchanged: true }).hooks['astro:config:setup']({
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
  });
});

describe('livePreview integration — hooks that need a request', () => {
  // Inline and loader delivery decide once, at build time, for every page; a function that is meant
  // to run per request never would. The middleware mode already refuses both, the Nuxt module's
  // options do not have them, and `authorizePreviewModule` is refused here the same way.
  const setup = (options: Parameters<typeof livePreview>[0]): ReturnType<typeof vi.fn> => {
    const injectScript = vi.fn();
    livePreview(options).hooks['astro:config:setup']({ injectScript, updateConfig: vi.fn() });
    return injectScript;
  };
  const authorize = (): null => null;
  const decide = (): boolean => false;

  it('has no place for them in its type', () => {
    // @ts-expect-error -- `authorizePreview` left LivePreviewAstroOptions in 3.0
    const withHook: AstroOptions = { authorizePreview: authorize };
    // @ts-expect-error -- `shouldInject` left LivePreviewAstroOptions in 3.0
    const withDecision: AstroOptions = { shouldInject: decide };

    expect(() => setup(withHook)).toThrow(/authorizePreview/u);
    expect(() => setup(withDecision)).toThrow(/shouldInject/u);
  });

  it.each([
    ['inline', undefined],
    ['inline', 'inline' as const],
    ['loader', 'loader' as const],
  ])('refuses authorizePreview in %s delivery, naming where it can run (mode %s)', (name, mode) => {
    expect(() =>
      setup(untyped({ ...(mode === undefined ? {} : { mode }), authorizePreview: authorize })),
    ).toThrow(
      `payload-live-preview: \`authorizePreview\` cannot be used with mode '${name}' — inline and ` +
        'loader delivery run no server hook, so the function would never be called. Use mode ' +
        "'middleware' with `authorizePreviewModule`, or register " +
        '`createLivePreviewMiddleware({ authorizePreview, ... })` in src/middleware.ts (ADR 0024).',
    );
  });

  it.each([
    ['inline', undefined],
    ['loader', 'loader' as const],
  ])('refuses shouldInject in %s delivery, naming where it can run (mode %s)', (name, mode) => {
    expect(() =>
      setup(untyped({ ...(mode === undefined ? {} : { mode }), shouldInject: decide })),
    ).toThrow(
      `payload-live-preview: \`shouldInject\` cannot be used with mode '${name}' — inline and ` +
        'loader delivery decide once, at build time, for every page, so the function would never ' +
        "be called. Use mode 'middleware' with `previewQueryParams` or `previewSignals`, or " +
        'register `createLivePreviewMiddleware({ shouldInject, ... })` in src/middleware.ts.',
    );
  });

  it('refuses them before it injects anything, and with autoInject: false too', () => {
    const injectScript = vi.fn();
    expect(() =>
      livePreview(untyped({ autoInject: false, authorizePreview: authorize })).hooks[
        'astro:config:setup'
      ]({ injectScript }),
    ).toThrow(/authorizePreview/u);
    expect(() =>
      livePreview(untyped({ autoInject: false, shouldInject: decide })).hooks['astro:config:setup'](
        { injectScript },
      ),
    ).toThrow(/shouldInject/u);
    expect(injectScript).not.toHaveBeenCalled();
  });

  it('still accepts the options that only describe a request, which a shared object may carry', () => {
    expect(
      setup({ strict: true, previewSignals: ['query'], previewQueryParams: ['preview'] }),
    ).toHaveBeenCalledOnce();
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
      mode: 'middleware',
      authorizePreviewModule: './src/authorize.ts',
      allowedOrigins: [ADMIN],
      serverURL: ADMIN,
      mergeDepth: 1,
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
    expect(moduleSource).toContain('export default {');
    expect(moduleSource).not.toContain('"mode"');
  });

  it('rejects shouldInject in middleware mode (not serializable)', () => {
    const integration = livePreview(untyped({ mode: 'middleware', shouldInject: () => true }));
    expect(() => {
      integration.hooks['astro:config:setup'](makeSetupContext());
    }).toThrow(/shouldInject/);
  });

  it('escapes </script>-breaking sequences in the serialized options', () => {
    const ctx = makeSetupContext();
    livePreview({
      mode: 'middleware',
      authorizePreviewModule: './src/authorize.ts',
      previewQueryParams: ['x</script><script>'],
    }).hooks['astro:config:setup'](ctx);
    const plugin = ctx.plugins[0]!;
    const source = plugin.load!(plugin.resolveId!('virtual:payload-live-preview/options')!)!;
    expect(source).not.toContain('</script>');
  });

  it("fails fast for mode:'middleware' without a hook module, naming the resolutions", () => {
    const ctx = makeSetupContext();
    const integration = livePreview({ mode: 'middleware', allowedOrigins: [ADMIN] });
    expect(() => {
      integration.hooks['astro:config:setup'](ctx);
    }).toThrow(
      /cannot carry the `authorizePreview` function the middleware requires\. Name the module that exports it in `authorizePreviewModule` \(ADR 0024\), or register `createLivePreviewMiddleware\(\{ authorizePreview, \.\.\. \}\)` yourself in src\/middleware\.ts/u,
    );
    expect(ctx.addMiddleware).not.toHaveBeenCalled();
  });

  it('refuses `strict: false` and the 1.x profile in every mode, before it registers anything', () => {
    // 3.0 removed both (ADR 0007, rows 21 and 36). A JavaScript config can still pass them.
    for (const mode of ['inline', 'loader', 'middleware'] as const) {
      const ctx = makeSetupContext();
      const withStrictOff = {
        mode,
        strict: false,
        allowedOrigins: [ADMIN],
      } as unknown as AstroOptions;
      const withProfile = {
        mode,
        defaults: 'v1',
        allowedOrigins: [ADMIN],
      } as unknown as AstroOptions;

      expect(() => {
        livePreview(withStrictOff).hooks['astro:config:setup'](ctx);
      }).toThrow('payload-live-preview: `strict: false` was removed in 3.0; remove the option.');
      expect(() => {
        livePreview(withProfile).hooks['astro:config:setup'](ctx);
      }).toThrow("payload-live-preview: `defaults: 'v1'` was removed in 3.0.");
      expect(ctx.addMiddleware).not.toHaveBeenCalled();
      expect(ctx.injectScript).not.toHaveBeenCalled();
    }
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

  it('imports the hook named by authorizePreviewModule', () => {
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
      optionsModule(
        untyped({ authorizePreviewModule: './src/authorize.ts', authorizePreview: () => null }),
      ),
    ).toThrow(/authorizePreview/u);
  });
});
