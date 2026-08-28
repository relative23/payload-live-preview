import { describe, expect, it, vi } from 'vitest';
import { bakeConfig } from './runtime-harness';

describe('bootstrapInlineRuntime — fragments (ADR 0011)', () => {
  it('wires the fragment client when the prelude is present and the wire slot names an endpoint', async () => {
    const { createFragmentStrategy, createRouteStrategy } = await import('@fragment/index');
    vi.stubGlobal('__LIVE_PREVIEW_FRAGMENT__', { createFragmentStrategy, createRouteStrategy });
    document.body.innerHTML =
      '<section data-payload-fragment="hero"><h1 data-payload-field="title">old</h1></section>';
    const tuple = [...bakeConfig(), '/payload/fragment'];
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: unknown }).__LIVE_PREVIEW_CONFIG__ = tuple;
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api?.inspect().fragments.handler).toBe(true);
    api?.destroy();
    vi.unstubAllGlobals();
  });
  it('has no fragment client without the prelude, whatever the wire slot says', async () => {
    vi.stubGlobal('__LIVE_PREVIEW_FRAGMENT__', undefined);
    document.body.innerHTML = '';
    const tuple = [...bakeConfig(), '/payload/fragment'];
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: unknown }).__LIVE_PREVIEW_CONFIG__ = tuple;
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api?.inspect().fragments.handler).toBe(false);
    api?.destroy();
    vi.unstubAllGlobals();
  });
});
