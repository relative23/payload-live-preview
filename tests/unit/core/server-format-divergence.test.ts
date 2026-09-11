/**
 * Z20: the exception the fidelity oracle recorded first. A `<time>` bound to
 * `publishedAt` shows what the template printed — in the shipped fixtures the
 * stored ISO string — and the date renderer writes a formatted one over it.
 * The patch succeeds, so Z3's escalation never sees it, and the page quietly
 * stops matching the server.
 *
 * Z3 measured why escalating is the wrong answer here (the route redraws the
 * server's format and the re-apply overwrites it again) and why withholding
 * needs a judgement nobody can make (the first message may already carry
 * unsaved edits). What is left is to say it out loud, once, where a developer
 * will read it — and to stay quiet everywhere that difference means something
 * else. These tests are mostly about the second half.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import type { RouteStrategy } from '@core/strategies';
import type { LivePreviewRuntime } from '@core/lifecycle';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/** The value the shipped fixtures print raw and store as an instant. */
const ISO = '2025-04-12T08:30:00.000Z';

function fakeRoute(): RouteStrategy & { refreshes: number } {
  const strategy = {
    refreshes: 0,
    plan: (): boolean => false,
    refresh: (): Promise<'refreshed'> => {
      strategy.refreshes += 1;
      return Promise.resolve('refreshed' as const);
    },
  };
  return strategy;
}

function start(
  warnings: string[],
  overrides: Partial<ConstructorParameters<typeof LivePreviewRuntime>[0]> = {},
): LivePreviewRuntime {
  const runtime = makeRuntime({
    renderers: buildBuiltinRenderers(),
    warn: (...args: unknown[]): void => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    },
    ...overrides,
  });
  runtime.start();
  return runtime;
}

/** One message per call, each flushed before the next. */
async function send(...messages: Record<string, unknown>[]): Promise<void> {
  for (const data of messages) {
    fireMessage({ type: 'payload-live-preview', data });
    await vi.advanceTimersByTimeAsync(50);
  }
}

function lp0412(warnings: readonly string[]): string[] {
  return warnings.filter((line) => line.includes('LP0412'));
}

describe('a template that formatted what the renderer formats differently', () => {
  it('says so once, naming both readings and the attribute that settles them', async () => {
    document.body.innerHTML = `<time data-payload-field="publishedAt">${ISO}</time>`;
    const warnings: string[] = [];
    const runtime = start(warnings);

    await send({ publishedAt: ISO });

    const reported = lp0412(warnings);
    expect(reported, 'the first write to the binding is reported').toHaveLength(1);
    expect(reported[0]).toContain('publishedAt');
    // Both readings, so a developer can see which one the template chose.
    expect(reported[0]).toContain(ISO);
    expect(reported[0]).toContain(document.querySelector('time')?.textContent ?? '<none>');
    expect(reported[0]).toContain('data-payload-format');
    runtime.destroy();
  });

  it('reports the binding, not the message: a re-stamped date stays quiet', async () => {
    // The mock admin in every shipped example re-stamps `publishedAt` on each
    // message. Per message this would be a warning per keystroke forever.
    document.body.innerHTML = `<time data-payload-field="publishedAt">${ISO}</time>`;
    const warnings: string[] = [];
    const runtime = start(warnings);

    await send(
      { publishedAt: ISO },
      { publishedAt: '2026-01-01T00:00:00.000Z' },
      { publishedAt: '2026-02-02T12:00:00.000Z' },
    );

    expect(lp0412(warnings)).toHaveLength(1);
    runtime.destroy();
  });

  it('does not escalate: the route would redraw the format it is complaining about', async () => {
    document.body.innerHTML = `<time data-payload-field="publishedAt">${ISO}</time>`;
    const warnings: string[] = [];
    const route = fakeRoute();
    const runtime = start(warnings, { strategies: { route } });

    await send({ publishedAt: ISO });

    expect(lp0412(warnings)).toHaveLength(1);
    expect(route.refreshes, 'a formatting difference is a diagnosis, not an escalation').toBe(0);
    runtime.destroy();
  });
});

describe('what it stays quiet about', () => {
  it('is silent when the markup already answered with data-payload-format', async () => {
    document.body.innerHTML = `<time data-payload-field="publishedAt" data-payload-format="date:short">${ISO}</time>`;
    const warnings: string[] = [];
    const runtime = start(warnings);

    await send({ publishedAt: ISO });

    expect(lp0412(warnings)).toEqual([]);
    runtime.destroy();
  });

  it('is silent for a text field, where a difference is simply an edit', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
    const warnings: string[] = [];
    const runtime = start(warnings);

    // The first message of a connection may already carry unsaved changes, so
    // this difference proves nothing about formatting. Z3 measured that the
    // two cannot be told apart; here they need not be.
    await send({ title: 'Typed before the preview connected' });

    expect(lp0412(warnings)).toEqual([]);
    runtime.destroy();
  });

  it('is silent when the element was empty, because nothing was lost', async () => {
    document.body.innerHTML = '<time data-payload-field="publishedAt"></time>';
    const warnings: string[] = [];
    const runtime = start(warnings);

    await send({ publishedAt: ISO });

    expect(lp0412(warnings)).toEqual([]);
    runtime.destroy();
  });

  it('is silent when the template and the renderer already agree', async () => {
    document.body.innerHTML =
      '<span data-payload-field="count" data-payload-type="number">12</span>';
    const warnings: string[] = [];
    const runtime = start(warnings);

    await send({ count: 12 });

    expect(lp0412(warnings)).toEqual([]);
    runtime.destroy();
  });

  it('reads the channel the renderer writes, so a date input is judged on its value', async () => {
    document.body.innerHTML =
      '<input data-payload-field="publishedAt" type="date" value="2025-04-12">';
    const warnings: string[] = [];
    const runtime = start(warnings);

    await send({ publishedAt: ISO });

    // `formatForInput` writes the day in local time; the fixture value is the
    // same day, so the control keeps what the server put there.
    expect(lp0412(warnings)).toEqual([]);
    runtime.destroy();
  });

  it("is silent under onUnfaithfulPatch: 'ignore', which asked not to be told", async () => {
    document.body.innerHTML = `<time data-payload-field="publishedAt">${ISO}</time>`;
    const warnings: string[] = [];
    const runtime = start(warnings, { onUnfaithfulPatch: 'ignore' });

    await send({ publishedAt: ISO });

    expect(lp0412(warnings)).toEqual([]);
    runtime.destroy();
  });
});
