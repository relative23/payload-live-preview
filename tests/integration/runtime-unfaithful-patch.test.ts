/**
 * The inline runtime's side of Z3: the wire tuple carries `onUnfaithfulPatch`
 * in a slot of its own, an omitted slot means the new default rather than the
 * 2.0 one, and the 2.0 slot still decides when the generator wrote it.
 *
 * Worth its own file at this level because the tuple is positional and
 * append-only: `src/core/runtime.ts` destructures by position, and the only
 * proof that slot 21 is read as slot 21 is a runtime built from one.
 */

import { describe, expect, it } from 'vitest';
import { INLINE_CONFIG_KEYS, type InlineScriptConfig } from '@/types/inline-config';
import type { RouteStrategy } from '@core/strategies';
import { TRUSTED, type BakedConfigTuple } from './runtime-harness';

/** The wire literal the generator writes, from the same key table it writes it from. */
function wireConfig(config: Partial<InlineScriptConfig>): BakedConfigTuple {
  const full: Partial<InlineScriptConfig> = {
    allowedOrigins: [TRUSTED],
    debounceMs: 0,
    enableA11y: false,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    disableLocalhostMatching: true,
    eventSourcePolicy: 'any',
    routeStrategy: true,
    ...config,
  };
  return INLINE_CONFIG_KEYS.map((key) => full[key]);
}

/** Stands in for the route prelude the generator would have put ahead of the runtime. */
function installRoutePrelude(): { refreshes: number } {
  const strategy = {
    refreshes: 0,
    plan: (): boolean => false,
    refresh: (): Promise<'refreshed'> => {
      strategy.refreshes += 1;
      return Promise.resolve('refreshed' as const);
    },
  } satisfies RouteStrategy & { refreshes: number };
  (globalThis as { __LIVE_PREVIEW_ROUTE__?: unknown }).__LIVE_PREVIEW_ROUTE__ = {
    createRouteStrategy: () => strategy,
  };
  return strategy;
}

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data, globalSlug: 'home' },
      origin: TRUSTED,
    }),
  );
}

/** Connect (the baseline message sits out every judgement), then change an unbound field. */
async function connectThenChangeSomethingUnbound(): Promise<void> {
  post({ title: 'Server rendered' });
  await Promise.resolve();
  post({ title: 'Server rendered', tagline: 'nothing binds this' });
  await Promise.resolve();
  await Promise.resolve();
}

async function bootstrapWith(config: Partial<InlineScriptConfig>): Promise<{ refreshes: number }> {
  document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
  const route = installRoutePrelude();
  (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
    wireConfig(config);
  const { bootstrapInlineRuntime } = await import('@core/runtime');
  const api = bootstrapInlineRuntime();
  await connectThenChangeSomethingUnbound();
  api?.destroy();
  Reflect.deleteProperty(globalThis, '__LIVE_PREVIEW_ROUTE__');
  return route;
}

describe('bootstrapInlineRuntime — onUnfaithfulPatch over the wire', () => {
  it('escalates by default, with the slot left empty', async () => {
    expect((await bootstrapWith({})).refreshes).toBe(1);
  });

  it('reads slot 21 as the new option, not as a neighbour', async () => {
    expect((await bootstrapWith({ onUnfaithfulPatch: 'ignore' })).refreshes).toBe(0);
    expect((await bootstrapWith({ onUnfaithfulPatch: 'warn' })).refreshes).toBe(0);
    expect((await bootstrapWith({ onUnfaithfulPatch: 'escalate' })).refreshes).toBe(1);
  });

  it("keeps obeying the 2.0 slot a page's generated script may still carry", async () => {
    expect((await bootstrapWith({ onUnboundChange: 'ignore' })).refreshes).toBe(0);
    expect((await bootstrapWith({ onUnboundChange: 'route' })).refreshes).toBe(1);
  });
});
