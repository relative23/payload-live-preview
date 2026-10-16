import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager } from '@plugins/manager';
import { EventEmitter } from '@events/emitter';
import {
  createUnboundFieldsOverlayPlugin,
  guessedBindingsIn,
  unboundFieldNames,
} from '@plugins/built-in/unbound-fields-overlay';
import type { PayloadLivePreviewData } from '@/types/payload-protocol';

/**
 * The overlay answers one question — which of this update's fields has the page
 * nowhere to put — and it must answer it the way the runtime does, or it sends
 * someone annotating a template after fields that are already bound.
 */

const PANEL = '#payload-live-preview-unbound';

function manager(config: Record<string, unknown>): {
  events: EventEmitter;
  manager: PluginManager;
} {
  const events = new EventEmitter();
  return {
    events,
    manager: new PluginManager({
      events,
      config: Object.freeze(config),
      registerFieldRenderer: () => () => {},
      log: () => {},
    }),
  };
}

async function update(events: EventEmitter, fields: Record<string, unknown>): Promise<void> {
  const data: PayloadLivePreviewData = { fields };
  await events.emit('afterUpdate', { data, updatedCount: 1, durationMs: 1 });
}

function panelText(): string {
  return document.querySelector(PANEL)?.textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('unboundFieldNames', () => {
  it('reports what nothing on the page covers, sorted', () => {
    expect(unboundFieldNames({ title: 'a', tagline: 'b', body: 'c' }, ['body'])).toEqual([
      'tagline',
      'title',
    ]);
  });

  it('counts a binding on a path inside the field as covering it', () => {
    // The admin's diff names top-level fields; the markup usually binds leaves.
    expect(unboundFieldNames({ hero: { eyebrow: 'a' } }, ['hero.eyebrow'])).toEqual([]);
  });

  it('counts the locale-suffixed name Payload sends', () => {
    expect(unboundFieldNames({ title_de: 'Titel' }, ['title'], 'de')).toEqual([]);
    expect(unboundFieldNames({ title_de: 'Titel' }, ['title'], 'en')).toEqual(['title_de']);
  });

  it('never reports the fields Payload ships with every document', () => {
    expect(
      unboundFieldNames({ id: '1', updatedAt: 'now', _status: 'draft', title: 'a' }, ['title']),
    ).toEqual([]);
  });
});

describe('the unbound-fields overlay', () => {
  it('lists the unbound fields and hides itself once they are bound', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">t</h1>';
    const { events, manager: plugins } = manager({ debug: true });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    await update(events, { title: 'a', tagline: 'b' });
    expect(panelText()).toContain('tagline');
    expect(document.querySelector<HTMLElement>(PANEL)?.hidden).toBe(false);

    // The template gained the missing binding; the next update finds nothing.
    document.body.innerHTML += '<p data-payload-field="tagline">b</p>';
    await update(events, { title: 'a', tagline: 'b' });
    expect(document.querySelector<HTMLElement>(PANEL)?.hidden).toBe(true);
  });

  it('copies the attribute to paste, and says it did', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { events, manager: plugins } = manager({ debug: true });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    await update(events, { tagline: 'b' });
    const button = document.querySelector<HTMLButtonElement>(`${PANEL} button`);
    button?.click();

    expect(writeText).toHaveBeenCalledWith('data-payload-field="tagline"');
    expect(button?.textContent).toBe('tagline ✓');
  });

  it('stays out of a client that is not in debug mode', async () => {
    const { events, manager: plugins } = manager({ debug: false });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    await update(events, { tagline: 'b' });

    expect(document.querySelector(PANEL)).toBeNull();
  });

  it('mounts without debug when asked explicitly, and leaves nothing behind', async () => {
    const { events, manager: plugins } = manager({});
    await plugins.register(createUnboundFieldsOverlayPlugin({ onlyWithDebug: false }));
    await update(events, { tagline: 'b' });
    expect(document.querySelector(PANEL)).not.toBeNull();

    await plugins.unregister('unbound-fields');

    expect(document.querySelector(PANEL)).toBeNull();
  });

  it('lists a guessed binding apart from the unbound fields, with the value it matched', async () => {
    // What the runtime stamps under `autoBind: 'unique'` (ADR 0014): the
    // binding a template would carry, plus the marker with the matched value.
    document.body.innerHTML =
      '<h1 data-payload-field="title" data-payload-guessed="Hello from the demo">Hello from the demo</h1>' +
      '<p data-payload-field="subtitle">declared</p>';
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { events, manager: plugins } = manager({ debug: true });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    await update(events, { title: 'a', subtitle: 'b', tagline: 'c' });

    expect(guessedBindingsIn(document)).toEqual([
      { field: 'title', matched: 'Hello from the demo' },
    ]);
    const guessedTitle = document.querySelector<HTMLElement>('[data-testid="guessed-bindings"]');
    expect(guessedTitle?.hidden).toBe(false);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(`${PANEL} button`)];
    // `tagline` is unbound; `title` is bound, but by a guess, and says what it matched.
    expect(buttons.map((button) => button.textContent)).toEqual([
      'tagline',
      'title ← "Hello from the demo"',
    ]);
    buttons[1]?.click();
    expect(writeText).toHaveBeenCalledWith('data-payload-field="title"');
  });

  it('hides the guessed section on a page that declared everything', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">t</h1>';
    const { events, manager: plugins } = manager({ debug: true });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    await update(events, { title: 'a', tagline: 'b' });

    expect(document.querySelector<HTMLElement>('[data-testid="guessed-bindings"]')?.hidden).toBe(
      true,
    );
  });

  it('lays itself out through the CSSOM, which a strict style-src does not refuse', async () => {
    // `setAttribute('style')` is an inline style attribute to a CSP that
    // refuses them (PHD-03); declarations set through `element.style` are not.
    // No clipboard: the copy falls back to a hidden text area, styled the same way.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    const { events, manager: plugins } = manager({ debug: true });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    await update(events, { tagline: 'b' });
    document.querySelector<HTMLButtonElement>(`${PANEL} button`)?.click();

    expect(setAttribute.mock.calls.map(([name]) => name)).not.toContain('style');
    expect(document.querySelector<HTMLElement>(PANEL)?.style.position).toBe('fixed');
    expect(document.querySelector<HTMLElement>(`${PANEL} button`)?.style.cursor).toBe('pointer');
    expect(document.querySelector<HTMLElement>(`${PANEL} div`)?.style.fontWeight).toBe('600');
    setAttribute.mockRestore();
  });

  it('leaves out what the page declares with data-payload-covers', async () => {
    document.body.innerHTML =
      '<h1 data-payload-field="title">t</h1><i data-payload-covers="seo"></i>';
    const { events, manager: plugins } = manager({ debug: true });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    await update(events, { title: 'a', seo: { title: 's' }, tagline: 'b' });

    expect(panelText()).toContain('tagline');
    expect(panelText()).not.toContain('seo');
  });

  it('leaves out what a configured strategy renders, and only then', async () => {
    const page =
      '<h1 data-payload-field="title">t</h1>' +
      '<section data-payload-fragment="pricing" data-payload-depends="pricing"></section>' +
      '<div data-payload-island="x"><section data-payload-fragment="plans" data-payload-depends="plans"></section></div>';
    const fields = { title: 'a', pricing: 1, plans: 2 };
    document.body.innerHTML = page;
    const rendered = manager({ debug: true, strategies: { fragment: () => {} } });
    await rendered.manager.register(createUnboundFieldsOverlayPlugin());
    await update(rendered.events, fields);
    expect(panelText()).not.toContain('pricing');
    // The fragment planner leaves a boundary inside an island to the island.
    expect(panelText()).toContain('plans');
    await rendered.manager.destroyAll();

    document.body.innerHTML = page;
    const unrendered = manager({ debug: true, strategies: { route: {} } });
    await unrendered.manager.register(createUnboundFieldsOverlayPlugin());
    await update(unrendered.events, fields);
    expect(panelText()).toContain('pricing');
  });

  it("lists the uncovered path inside a partly bound group under subfieldCoverage: 'declared'", async () => {
    document.body.innerHTML = '<p data-payload-field="hero.eyebrow">e</p>';
    const hero = { eyebrow: 'e', description: 'd' };
    const declared = manager({ debug: true, subfieldCoverage: 'declared' });
    await declared.manager.register(createUnboundFieldsOverlayPlugin());
    await update(declared.events, { hero });
    expect(panelText()).toContain('hero.description');
    expect(panelText()).not.toContain('hero.eyebrow');
    await declared.manager.destroyAll();

    document.body.innerHTML = '<p data-payload-field="hero.eyebrow">e</p>';
    const descendant = manager({ debug: true });
    await descendant.manager.register(createUnboundFieldsOverlayPlugin());
    await update(descendant.events, { hero });
    expect(panelText()).not.toContain('hero');
  });

  it('is not a binding target itself', async () => {
    const { manager: plugins } = manager({ debug: true });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    // The overlay lives in the same document as the bindings; a stray
    // `data-payload-field` inside it would make the runtime patch the tool.
    expect(document.querySelectorAll(`${PANEL} [data-payload-field]`)).toHaveLength(0);
    expect(document.querySelector(PANEL)?.getAttribute('aria-hidden')).toBe('true');
  });
});
