import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { generateInlineScript, generateLoaderScript } from '@inline/generator';

const TARGET = {
  runtimeSrc: '/_lp/runtime.a1b2c3d4.js',
  integrity: 'sha384-Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFy',
} as const;

interface AppendedScript {
  src?: string;
  integrity?: string;
  crossOrigin?: string;
  async?: boolean;
}

/**
 * Run the generated bootstrap the way a browser would.
 *
 * A string assertion proves the URL was substituted; only execution proves the
 * bootstrap appends a script, and only under a context that says "this is a
 * preview". Both halves matter: the whole feature is a decision not to load.
 */
function runLoader(
  script: string,
  context: { inIframe: boolean },
): { appended: AppendedScript[]; config: unknown } {
  const sandbox = runLoaderSandbox(script, context);
  return {
    appended: sandbox['appended'] as AppendedScript[],
    config: sandbox['__LIVE_PREVIEW_CONFIG__'],
  };
}

/** The sandbox after the script ran, for assertions on what it left on `window`. */
function runLoaderSandbox(script: string, context: { inIframe: boolean }): Record<string, unknown> {
  const appended: AppendedScript[] = [];
  const head = {
    appendChild(node: AppendedScript) {
      appended.push(node);
      return node;
    },
  };
  const sandbox: Record<string, unknown> = {
    document: {
      head,
      createElement: (): AppendedScript => ({}),
      // Referrer detection is not part of the bootstrap's decision, but the
      // shared helper reads it.
      referrer: '',
    },
    location: { href: 'https://site.example.com/page' },
  };
  // `self !== top` is what isInIframe() checks.
  sandbox['window'] = sandbox;
  sandbox['self'] = sandbox;
  sandbox['top'] = context.inIframe ? { different: true } : sandbox;
  sandbox['parent'] = context.inIframe ? { different: true } : sandbox;
  sandbox['opener'] = null;
  sandbox['globalThis'] = sandbox;
  sandbox['appended'] = appended;

  runInNewContext(script, sandbox);
  return sandbox;
}

describe('generateLoaderScript — substitution', () => {
  it('declares the asset and its integrity for the bootstrap to read', () => {
    const script = generateLoaderScript({}, TARGET);
    expect(script).toContain('var __LP_RUNTIME_SRC__=');
    expect(script).toContain('var __LP_RUNTIME_INTEGRITY__=');
    expect(script).toContain(TARGET.runtimeSrc);
    expect(script).toContain(TARGET.integrity);
  });

  it('carries the configuration but not the runtime', () => {
    const script = generateLoaderScript(
      {
        allowedOrigins: ['https://cms.example.com'],
        serverURL: 'https://cms.example.com',
        mergeDepth: 1,
      },
      TARGET,
    );
    expect(script).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(script).toContain('https://cms.example.com');
    // The whole point: the runtime body stays out of the page.
    expect(script).not.toContain('MutationObserver');
    expect(script.length).toBeLessThan(generateInlineScript({}).length / 20);
  });

  it('uses the same config wire format as the inline script', () => {
    // Both read back through the same positional literal; a divergence here
    // would be invisible until a deployed preview mis-parsed its own options.
    const config = { allowedOrigins: ['https://a.example'], mergeDepth: 3, debug: true };
    const literal = (script: string): string => {
      const match = /var __LIVE_PREVIEW_CONFIG__=(\[[^;]*\]);/u.exec(script);
      if (match?.[1] === undefined) throw new Error('config literal missing');
      return match[1];
    };
    expect(literal(generateLoaderScript(config, TARGET))).toBe(
      literal(generateInlineScript(config)),
    );
  });

  it('emits the bootstrap armed for React when the page declares hydration, the plain one otherwise', () => {
    // ADR 0015 F2: the runtime arrives as a fetched asset that may land after
    // react-dom, so the arming travels with the bootstrap that is in <head> —
    // as one script, so the bootstrap stays a fraction of what it defers.
    const declared = generateLoaderScript({ hydration: 'react' }, TARGET);
    const plain = generateLoaderScript({}, TARGET);

    expect(declared).toContain('__REACT_DEVTOOLS_GLOBAL_HOOK__');
    expect(declared.split('createElement("script")')).toHaveLength(2);
    // The static-page floor stays what it was: a page that declares nothing pays nothing.
    expect(plain).not.toContain('__REACT_DEVTOOLS_GLOBAL_HOOK__');
    expect(plain).toBe(generateLoaderScript({}, TARGET));
  });

  it('emits the plain bootstrap for a page that declares Vue: the mount is state a late runtime can read', () => {
    const vue = generateLoaderScript({ hydration: 'vue' }, TARGET);
    const plain = generateLoaderScript({}, TARGET);

    expect(vue).not.toContain('__REACT_DEVTOOLS_GLOBAL_HOOK__');
    expect(vue).not.toContain('__vue_app__');
    // Only the config statement differs: the slot the runtime reads.
    expect(vue.split('\n').slice(1)).toEqual(plain.split('\n').slice(1));
    expect(vue).toContain('"vue"');
  });

  it('escapes `<` in the asset URL so `</script>` cannot break the tag', () => {
    const script = generateLoaderScript({}, { runtimeSrc: '/x</script><b>.js' });
    expect(script).not.toContain('</script>');
    expect(script).toContain('\\u003C');
  });

  it('refuses an empty runtimeSrc rather than emitting a script that fetches nothing', () => {
    expect(() => generateLoaderScript({}, { runtimeSrc: '' })).toThrow(/runtimeSrc/u);
  });
});

describe('generateLoaderScript — what the browser does with it', () => {
  it("arms React's hook before it appends the runtime, on a page that declares hydration", () => {
    const script = generateLoaderScript({ hydration: 'react' }, TARGET);
    const sandbox = runLoaderSandbox(script, { inIframe: true });

    const hook = sandbox['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as
      { supportsFiber?: boolean; onCommitFiberRoot?: unknown } | undefined;
    expect(hook?.supportsFiber).toBe(true);
    expect(typeof hook?.onCommitFiberRoot).toBe('function');
    expect(sandbox['appended']).toHaveLength(1);
    // And not on a page that declared nothing: the hook is React's to find.
    expect(
      runLoaderSandbox(generateLoaderScript({}, TARGET), { inIframe: true })[
        '__REACT_DEVTOOLS_GLOBAL_HOOK__'
      ],
    ).toBeUndefined();
  });

  it('appends the runtime, with integrity and crossorigin, inside a preview', () => {
    const { appended, config } = runLoader(generateLoaderScript({}, TARGET), {
      inIframe: true,
    });

    expect(appended).toHaveLength(1);
    expect(appended[0]?.src).toBe(TARGET.runtimeSrc);
    expect(appended[0]?.integrity).toBe(TARGET.integrity);
    // Integrity is not enforced on a cross-origin fetch without this.
    expect(appended[0]?.crossOrigin).toBe('anonymous');
    expect(appended[0]?.async).toBe(true);
    expect(config).toBeDefined();
  });

  it('appends nothing on an ordinary top-level page', () => {
    // The saving is the absence of this request. If this ever regresses, every
    // visitor pays for the runtime again and no other test would notice.
    const { appended } = runLoader(generateLoaderScript({}, TARGET), { inIframe: false });
    expect(appended).toEqual([]);
  });

  it('omits integrity and crossorigin when no hash was supplied', () => {
    const { appended } = runLoader(generateLoaderScript({}, { runtimeSrc: TARGET.runtimeSrc }), {
      inIframe: true,
    });
    expect(appended[0]?.src).toBe(TARGET.runtimeSrc);
    expect(appended[0]?.integrity).toBeUndefined();
    expect(appended[0]?.crossOrigin).toBeUndefined();
  });

  it('sets the configuration before appending, so the runtime can read it', () => {
    // The asset is configuration-free by design; if the global were assigned
    // after the append, a cached script could execute against no config.
    const script = generateLoaderScript({ allowedOrigins: ['https://cms.example'] }, TARGET);
    const configAt = script.indexOf('__LIVE_PREVIEW_CONFIG__');
    const appendAt = script.indexOf('appendChild');
    expect(configAt).toBeGreaterThanOrEqual(0);
    expect(appendAt).toBeGreaterThan(configAt);
  });
});

describe('the asset stays free of deployment secrets', () => {
  it('keeps every configured value in the inline body, never in the URL', () => {
    const script = generateLoaderScript(
      {
        allowedOrigins: ['https://cms.example.com'],
        serverURL: 'https://cms.example.com',
        mergeDepth: 1,
      },
      TARGET,
    );
    // The asset URL is the caller's hashed path and must carry no options:
    // it is long-lived and cached, and a token in it would outlive the page.
    expect(TARGET.runtimeSrc).not.toContain('cms.example.com');
    const { appended } = runLoader(script, { inIframe: true });
    expect(appended[0]?.src).toBe(TARGET.runtimeSrc);
  });
});
