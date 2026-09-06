/**
 * What the pipeline holds when the artifact was built lean.
 *
 * The profile is a build flag, so the branch that chooses the runner is
 * unreachable in a normal test run: `__LEAN_BUILD__` is `undefined` and every
 * suite takes the full path. The built artifact is covered elsewhere, in jsdom,
 * but that proves nothing about this source file. Stubbing the flag as a global
 * exercises the same branch esbuild folds, and with it the runner that plans
 * nothing, renders nothing, and says so once per feature.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  post,
  startRuntime,
  stubIntersectionObserver,
  textRenderer,
  TRUSTED,
} from '../../helpers/runtime';
import type { RuntimeHarness } from '../../helpers/runtime';

let harness: RuntimeHarness | undefined;
let warnings: string[];
/** The omission notice goes to the console, not the runtime's diagnostic sink. */
let consoleWarnings: string[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  stubIntersectionObserver();
  warnings = [];
  consoleWarnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    consoleWarnings.push(args.map((arg) => String(arg)).join(' '));
  });
});

afterEach(() => {
  harness?.runtime.destroy();
  harness = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A page whose binding asks for the fragment strategy the lean profile leaves out. */
function mount(): void {
  document.body.innerHTML =
    '<section data-payload-strategy="fragment" data-payload-fragment="hero">' +
    '<p data-payload-field="title">server rendered</p>' +
    '</section>';
}

function start(): void {
  harness = startRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    warn: (message: string) => {
      warnings.push(message);
    },
    debounceMs: 0,
    disableVisibilityGate: true,
  });
}

describe('the lean profile picks a runner that renders nothing', () => {
  it('leaves the markup as the server rendered it and names the missing feature once', async () => {
    vi.stubGlobal('__LEAN_BUILD__', true);
    mount();
    start();

    post({ title: 'edited in the admin' });
    await vi.advanceTimersByTimeAsync(50);
    post({ title: 'edited again' });
    await vi.advanceTimersByTimeAsync(50);

    const omitted = consoleWarnings.filter((message) => message.includes('LP0104'));
    expect(omitted).toHaveLength(1);
    expect(omitted[0]).toContain('server-rendered fragments');
    // The boundary is not re-rendered, but the binding inside it is still a
    // binding: the lean profile drops the fragment machinery, not the patch.
    expect(document.querySelector('p')?.textContent).toBe('edited again');
    // The runtime's own sink still reports the unconfigured handler once.
    expect(warnings.filter((message) => message.includes('LP0806'))).toHaveLength(1);
  });

  it('takes the full runner when the flag is absent, which is every other suite', async () => {
    mount();
    start();

    post({ title: 'edited in the admin' });
    await vi.advanceTimersByTimeAsync(50);

    expect(consoleWarnings.filter((message) => message.includes('LP0104'))).toEqual([]);
  });
});
