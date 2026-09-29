import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { RouteStrategy } from '@core/strategies';
import type { FieldRenderer } from '@core/types';
import { TRUSTED, fireMessage, textRenderer } from './lifecycle-harness';

/**
 * H02 and ADR 0022. The diff names top-level fields, so one bound descendant
 * (`hero.eyebrow`) used to make the whole group addressable: an edit of an
 * unbound sibling (`hero.description`) was neither escalated nor reported.
 * `subfieldCoverage: 'declared'` asks path by path below such a group, and
 * `data-payload-covers` declares what a page accounts for on purpose.
 */

type Mode = 'descendant' | 'declared';

const HERO = { eyebrow: 'Eyebrow', description: 'Saved description' };
/** Shows a structured value whole, so the fidelity check has nothing to escalate. */
const jsonRenderer: FieldRenderer = {
  name: 'test:json',
  render(target, value) {
    target.element.textContent = JSON.stringify(value);
  },
};
const PAGE = '<p data-payload-field="hero.eyebrow">Eyebrow</p><p>Saved description</p>';

function start(
  html: string,
  options: { subfieldCoverage?: Mode; scopeBindingsByOwner?: boolean } = {},
): { runtime: LivePreviewRuntime; refresh: ReturnType<typeof vi.fn>; warnings: () => string } {
  document.body.innerHTML = html;
  const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('refreshed');
  const warn = vi.fn();
  const runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer(), 'test:json': jsonRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    warn,
    strategies: { route: { plan: () => false, refresh } },
    ...options,
  });
  runtime.start();
  const warnings = (): string =>
    warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
  return { runtime, refresh, warnings };
}

async function send(fields: Record<string, unknown>, globalSlug?: string): Promise<void> {
  fireMessage({
    type: 'payload-live-preview',
    data: fields,
    ...(globalSlug === undefined ? {} : { globalSlug }),
  });
  await vi.advanceTimersByTimeAsync(50);
}

describe('the default: one bound descendant covers the group', () => {
  it('does not escalate an edit of an unbound sibling', async () => {
    const { runtime, refresh } = start(PAGE);
    await send({ hero: HERO });
    await send({ hero: { ...HERO, description: 'Edited description' } });
    expect(refresh).not.toHaveBeenCalled();
    runtime.destroy();
  });
});

describe("subfieldCoverage: 'declared'", () => {
  it('asks for the route when an unbound sibling of a bound child changes, and names it', async () => {
    const { runtime, refresh } = start(PAGE, { subfieldCoverage: 'declared' });
    await send({ hero: HERO });
    await send({ hero: { ...HERO, description: 'Edited description' } });
    expect(refresh).toHaveBeenCalledOnce();
    expect(runtime.inspect().fidelity.fields).toContain('hero.description');
    runtime.destroy();
  });

  it('patches an edit of the bound child without a refresh', async () => {
    const { runtime, refresh } = start(PAGE, { subfieldCoverage: 'declared' });
    await send({ hero: HERO });
    await send({ hero: { ...HERO, eyebrow: 'Edited eyebrow' } });
    expect(document.querySelector('[data-payload-field="hero.eyebrow"]')?.textContent).toBe(
      'Edited eyebrow',
    );
    expect(refresh).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('keeps a sibling the page covers on purpose out of the route', async () => {
    const { runtime, refresh } = start(PAGE + '<i data-payload-covers="hero.description"></i>', {
      subfieldCoverage: 'declared',
    });
    await send({ hero: HERO });
    await send({ hero: { ...HERO, description: 'Edited description' } });
    expect(refresh).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('names the uncovered path in LP0203 on the first message', async () => {
    const { runtime, warnings } = start(PAGE, { subfieldCoverage: 'declared' });
    await send({ hero: HERO });
    expect(warnings()).toMatch(/LP0203: field "hero\.description" has a value/);
    expect(warnings()).not.toMatch(/field "hero\.eyebrow"/);
    runtime.destroy();
  });

  it('names the scalars of an uncovered group inside the group, one level down', async () => {
    const { runtime, warnings } = start(PAGE, { subfieldCoverage: 'declared' });
    await send({
      hero: {
        ...HERO,
        cta: { label: 'Go', url: '/go', style: { tone: 'dark' } },
        tags: ['a', 'b'],
      },
    });
    expect(warnings()).toMatch(/LP0203: field "hero\.cta\.label" has a value/);
    expect(warnings()).toMatch(/LP0203: field "hero\.cta\.url" has a value/);
    // Never the group itself, a string's characters or an array's items.
    expect(warnings()).not.toMatch(/field "hero\.cta"/);
    expect(warnings()).not.toMatch(/hero\.cta\.style/);
    expect(warnings()).not.toMatch(/hero\.description\.0/);
    expect(warnings()).not.toMatch(/hero\.tags/);
    runtime.destroy();
  });

  it('stops at a bound rich-text or array field below the group', async () => {
    const body = {
      root: { children: Array.from({ length: 50 }, (_, i) => ({ text: `n${String(i)}` })) },
    };
    const { runtime, refresh } = start(
      PAGE +
        '<div data-payload-field="hero.body" data-payload-type="test:json"></div>' +
        '<ul data-payload-field="hero.tags" data-payload-type="test:json"></ul>',
      { subfieldCoverage: 'declared' },
    );
    await send({ hero: { ...HERO, body, tags: ['a'] } });
    await send({ hero: { ...HERO, body: { root: { children: [] } }, tags: ['a', 'b'] } });
    expect(refresh).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('counts a subtree past the depth bound as one changed path, conservatively', async () => {
    const deep = (leaf: string): Record<string, unknown> => {
      let node: Record<string, unknown> = { leaf };
      for (let i = 0; i < 12; i += 1) node = { next: node };
      return node;
    };
    const { runtime, refresh } = start(
      '<p data-payload-field="hero.eyebrow">Eyebrow</p><p data-payload-field="hero.deep.next.next.next.next.next.next.next.next.next.next.next.leaf">x</p>',
      { subfieldCoverage: 'declared' },
    );
    await send({ hero: { eyebrow: 'Eyebrow', deep: deep('a') } });
    await send({ hero: { eyebrow: 'Eyebrow', deep: deep('b') } });
    // The bound leaf sits below the bound; the walk cannot prove it covered.
    expect(refresh).toHaveBeenCalledOnce();
    runtime.destroy();
  });
});

describe('data-payload-covers', () => {
  it('makes an unbound top-level field addressable in the default mode too', async () => {
    const { runtime, refresh, warnings } = start(
      '<h1 data-payload-field="title">T</h1><i data-payload-covers="seo"></i>',
    );
    await send({ title: 'T', seo: { title: 'Saved' } });
    await send({ title: 'T', seo: { title: 'Edited' } });
    expect(refresh).not.toHaveBeenCalled();
    expect(warnings()).not.toMatch(/"seo/);
    runtime.destroy();
  });

  it("covers nothing for another document's update under owner scoping", async () => {
    const { runtime, refresh } = start(
      '<section data-payload-owner="global:home"><h1 data-payload-field="title">T</h1></section>' +
        '<section data-payload-owner="global:other"><i data-payload-covers="seo"></i></section>',
      { scopeBindingsByOwner: true },
    );
    await send({ title: 'T', seo: { title: 'Saved' } }, 'home');
    await send({ title: 'T', seo: { title: 'Edited' } }, 'home');
    expect(refresh).toHaveBeenCalledOnce();
    runtime.destroy();
  });
});
