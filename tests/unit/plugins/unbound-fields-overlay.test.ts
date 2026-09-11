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

  it('is not a binding target itself', async () => {
    const { manager: plugins } = manager({ debug: true });
    await plugins.register(createUnboundFieldsOverlayPlugin());

    // The overlay lives in the same document as the bindings; a stray
    // `data-payload-field` inside it would make the runtime patch the tool.
    expect(document.querySelectorAll(`${PANEL} [data-payload-field]`)).toHaveLength(0);
    expect(document.querySelector(PANEL)?.getAttribute('aria-hidden')).toBe('true');
  });
});
