/**
 * Three edits a patch writes without complaint and the page still does not
 * show: a block with no renderer whose own fields changed, a row that moved
 * away from the markup the server drew for it, and a `select` that shows a label
 * where Payload sends the option's value. Each has to be said, and the first two
 * handed to a strategy, because nothing else tells the editor the preview is
 * behind.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { __resetBlockWarningsForTests } from '@field-types/rich-text';
import type { RouteStrategy } from '@core/strategies';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

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

async function send(...edits: Record<string, unknown>[]): Promise<void> {
  for (const data of edits) {
    fireMessage({ type: 'payload-live-preview', data });
    await vi.advanceTimersByTimeAsync(1_200);
  }
}

function start(
  html: string,
  overrides: Parameters<typeof makeRuntime>[0] = {},
): { route: ReturnType<typeof fakeRoute>; runtime: ReturnType<typeof makeRuntime> } {
  document.body.innerHTML = html;
  const route = fakeRoute();
  const runtime = makeRuntime({
    renderers: buildBuiltinRenderers(),
    strategies: { route },
    warn: () => {},
    ...overrides,
  });
  runtime.start();
  return { route, runtime };
}

const paragraph = (text: string): Record<string, unknown> => ({
  type: 'paragraph',
  version: 1,
  children: [{ type: 'text', version: 1, text, format: 0 }],
});
const block = (fields: Record<string, unknown>): Record<string, unknown> => ({
  type: 'block',
  version: 2,
  fields: { id: 'b1', blockType: 'media', ...fields },
});
const rich = (...children: unknown[]): Record<string, unknown> => ({
  root: { type: 'root', version: 1, children },
});

beforeEach(() => {
  __resetBlockWarningsForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('a block with no renderer', () => {
  const BODY =
    '<div data-payload-field="body" data-payload-richtext=""><p>Text</p><figure>Old</figure></div>';

  it('hands the region over when the block itself changed', async () => {
    const { route, runtime } = start(BODY);
    await send(
      { body: rich(paragraph('Text'), block({ caption: 'Old' })) },
      { body: rich(paragraph('Text'), block({ caption: 'New' })) },
    );
    expect(route.refreshes).toBe(1);
    expect(runtime.inspect().fidelity.fields).toEqual(['body']);
    runtime.destroy();
  });

  it('asks for nothing when only the text around it changed', async () => {
    const { route, runtime } = start(BODY);
    await send(
      { body: rich(paragraph('Text'), block({ caption: 'Old' })) },
      { body: rich(paragraph('Typed'), block({ caption: 'Old' })) },
    );
    expect(document.querySelector('figure')?.textContent).toBe('Old');
    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });

  it('does not take a relation the merge populated for an edit', async () => {
    const { route, runtime } = start(BODY);
    await send(
      { body: rich(paragraph('Text'), block({ media: 2 })) },
      {
        body: rich(
          paragraph('Text'),
          block({ media: { id: 2, url: '/a.png', createdAt: 'x', updatedAt: 'y' } }),
        ),
      },
    );
    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });

  it('counts an edit to a row inside the block', async () => {
    const { route, runtime } = start(BODY);
    await send(
      { body: rich(paragraph('Text'), block({ rows: [{ id: 'r', label: 'Old' }] })) },
      { body: rich(paragraph('Text'), block({ rows: [{ id: 'r', label: 'New' }] })) },
    );
    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });
});

describe('a row that moved', () => {
  const LIST =
    '<ul><li><img src="/a.png"><b data-payload-field="items.0.title">A</b></li>' +
    '<li><img src="/b.png"><b data-payload-field="items.1.title">B</b></li></ul>';
  const a = { id: 'a', title: 'A' };
  const b = { id: 'b', title: 'B' };

  it('hands its bindings over, since the rest of the row stayed behind', async () => {
    const { route, runtime } = start(LIST);
    await send({ items: [a, b] }, { items: [b, a] });
    expect(route.refreshes).toBe(1);
    expect(runtime.inspect().fidelity.fields).toEqual(['items.0.title', 'items.1.title']);
    runtime.destroy();
  });

  it('notices rows of equal text, which leave every write unchanged', async () => {
    const { route, runtime } = start(LIST);
    const same = (id: string): Record<string, unknown> => ({ id, title: 'Same' });
    await send({ items: [same('a'), same('b')] }, { items: [same('b'), same('a')] });
    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  it('follows the rows of a nested array', async () => {
    const { route, runtime } = start('<b data-payload-field="layout.0.rows.0.title">A</b>');
    const layout = (id: string): Record<string, unknown>[] => [
      { id: 'block', rows: [{ id, title: 'A' }] },
    ];
    await send({ layout: layout('a') }, { layout: layout('b') });
    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  it('hands them over again when rows of equal text move back', async () => {
    const { route, runtime } = start(LIST);
    const same = (id: string): Record<string, unknown> => ({ id, title: 'Same' });
    await send(
      { items: [same('a'), same('b')] },
      { items: [same('b'), same('a')] },
      { items: [same('a'), same('b')] },
    );
    expect(route.refreshes).toBe(2);
    runtime.destroy();
  });

  it('does not take the rows of the next page for a move', async () => {
    const { route, runtime } = start(LIST);
    await send({ items: [a, b] });
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(1_200);
    await send({ items: [b, a] });
    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });

  it('asks for nothing when an edit leaves every row in place', async () => {
    const { route, runtime } = start(LIST);
    await send({ items: [a, b] }, { items: [{ ...a, title: 'Typed' }, b] });
    expect(document.querySelector('b')?.textContent).toBe('Typed');
    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });

  it('has no opinion on rows without an id', async () => {
    const { route, runtime } = start(LIST);
    await send(
      { items: [{ title: 'A' }, { title: 'B' }] },
      { items: [{ title: 'B' }, { title: 'A' }] },
    );
    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });

  it('leaves a binding of another document alone', async () => {
    const { runtime } = start(
      '<b data-payload-owner="collection:other:9" data-payload-field="items.0.title">A</b>',
      { scopeBindingsByOwner: true },
    );
    for (const row of [a, b]) {
      fireMessage({
        type: 'payload-live-preview',
        collectionSlug: 'pages',
        data: { id: 1, items: [row] },
      });
      await vi.advanceTimersByTimeAsync(1_200);
    }
    expect(document.querySelector('b')?.textContent).toBe('A');
    expect(runtime.inspect().fidelity.fields).not.toContain('items.0.title');
    runtime.destroy();
  });
});

describe('a select or radio that shows a label', () => {
  const warned = (warn: ReturnType<typeof vi.fn>): string[] =>
    warn.mock.calls.map((call) => String(call[0]));

  it('says the option value replaced what the template printed', async () => {
    const warn = vi.fn();
    const { runtime } = start(
      '<span data-payload-field="kind" data-payload-type="select">Long label</span>',
      { warn },
    );
    await send({ kind: 'long-value' });
    expect(warned(warn).filter((line) => line.includes('LP0412'))).toEqual([
      '[live-preview] LP0412: "kind" showed "Long label", the patch wrote "long-value" — ' +
        'Payload sends the value of an option, not its label. Render the label in a ' +
        'data-payload-fragment boundary, or bind it with data-payload-strategy="route".',
    ]);
    runtime.destroy();
  });

  it('stays quiet about a real select and a radio button, which show the value', async () => {
    const warn = vi.fn();
    const { runtime } = start(
      '<select data-payload-field="kind" data-payload-type="select">' +
        '<option value="a" selected>Label A</option><option value="b">Label B</option></select>' +
        '<input type="radio" value="a" data-payload-field="other" data-payload-type="radio">',
      { warn },
    );
    await send({ kind: 'b', other: 'a' });
    expect(document.querySelector('select')!.value).toBe('b');
    expect(warned(warn).filter((line) => line.includes('LP0412'))).toEqual([]);
    runtime.destroy();
  });

  it('keeps the format advice for the renderers that have one', async () => {
    const warn = vi.fn();
    const { runtime } = start(
      '<span data-payload-field="price" data-payload-type="number">12,00 €</span>',
      { warn },
    );
    await send({ price: 13 });
    expect(warned(warn).find((line) => line.includes('LP0412'))).toContain(
      'Set data-payload-format to match it.',
    );
    runtime.destroy();
  });
});
