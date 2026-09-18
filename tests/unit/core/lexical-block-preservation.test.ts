/**
 * LP-2: a Lexical block the registry cannot render used to replace the markup
 * the server had already rendered for it with an empty `<div>` — one keystroke
 * in any field and the image was gone from the preview. The claim under test is
 * that the server's subtree survives the write — and, where it cannot, that
 * the runtime says so (LP0413, `inspect().fidelity`) instead of claiming the
 * opposite (LP0410).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { __resetBlockWarningsForTests } from '@field-types/rich-text';
import { __resetBlockRegistryForTests } from '@lexical/blocks/registry';
import type { RouteStrategy } from '@core/strategies';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/** What Payload sends for a post whose body is a paragraph, a media block and a paragraph. */
function documentWith(intro: string): unknown {
  return {
    title: 'Title',
    content: {
      root: {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: intro }] },
          { type: 'block', fields: { blockType: 'mediaBlock', media: { id: 7 } } },
          { type: 'paragraph', children: [{ type: 'text', text: 'outro' }] },
        ],
      },
    },
  };
}

/** The richer version the project's own server renderer produced for that document. */
const SERVER_MARKUP =
  '<p>intro</p>' +
  '<figure class="mx-auto max-w-[72rem] my-10">' +
  '<img src="https://cdn.example.com/a.jpg" alt="a" width="800" height="600">' +
  '</figure>' +
  '<p>outro</p>';

/**
 * The demo post, as measured on 11 September: the site's `RichText` component
 * wraps its output in the Tailwind `prose` wrapper, and the blocks — five of
 * them, the media block a `<figure>` of two children — sit inside it.
 */
function demoDocument(title: string): unknown {
  return {
    title,
    content: {
      root: {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'Die Lichtprobe beginnt.' }] },
          { type: 'block', fields: { blockType: 'mediaBlock', media: { id: 7 } } },
          { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Der Aufbau' }] },
          { type: 'paragraph', children: [{ type: 'text', text: 'Zwei Scheinwerfer.' }] },
          {
            type: 'list',
            listType: 'bullet',
            children: [
              { type: 'listitem', children: [{ type: 'text', text: 'links' }] },
              { type: 'listitem', children: [{ type: 'text', text: 'rechts' }] },
            ],
          },
        ],
      },
    },
  };
}

const DEMO_SERVER_MARKUP =
  '<div class="prose-h7">' +
  '<p>Die Lichtprobe beginnt.</p>' +
  '<figure class="mx-auto max-w-[72rem] my-10">' +
  '<img src="https://cdn.example.com/a.jpg" alt="a" width="800" height="600">' +
  '<figcaption>Probe</figcaption>' +
  '</figure>' +
  '<h2>Der Aufbau</h2>' +
  '<p>Zwei Scheinwerfer.</p>' +
  '<ul><li>links</li><li>rechts</li></ul>' +
  '</div>';

/** The notation the audit measured the DOM in: `tag.class[children](…)`. */
function shapeOf(element: Element): string {
  const cls = element.classList.length > 0 ? `.${element.classList[0]!}` : '';
  const children = [...element.children].map(shapeOf).join(' ');
  return `${element.tagName.toLowerCase()}${cls}[${String(element.children.length)}]${
    children === '' ? '' : `( ${children} )`
  }`;
}

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

beforeEach(() => {
  __resetBlockRegistryForTests();
  __resetBlockWarningsForTests();
});

describe('a Lexical block without a renderer', () => {
  it("keeps the server's markup instead of replacing it with an empty div", async () => {
    document.body.innerHTML = `<div data-payload-field="content">${SERVER_MARKUP}</div>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: documentWith('edited') });
    await vi.advanceTimersByTimeAsync(50);

    const content = document.querySelector('[data-payload-field="content"]');
    const image = content?.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/a.jpg');
    expect(content?.querySelector('figure')?.getAttribute('class')).toBe(
      'mx-auto max-w-[72rem] my-10',
    );
    // The edit still landed: keeping a subtree is not skipping the write.
    expect(content?.querySelectorAll('p')[0]?.textContent).toBe('edited');
    const warned = warn.mock.calls.map(String).join(' ');
    expect(warned).toContain('LP0410');
    expect(warned).not.toContain('LP0413');
    expect(runtime.inspect().fidelity.unfaithful).toBe(0);
    warn.mockRestore();
    runtime.destroy();
  });

  it('keeps it across the next write too, so a second edit does not lose it', async () => {
    document.body.innerHTML = `<div data-payload-field="content">${SERVER_MARKUP}</div>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: documentWith('one') });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({ type: 'payload-live-preview', data: documentWith('two') });
    await vi.advanceTimersByTimeAsync(50);

    const content = document.querySelector('[data-payload-field="content"]');
    expect(content?.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/a.jpg',
    );
    expect(content?.querySelectorAll('p')[0]?.textContent).toBe('two');
    warn.mockRestore();
    runtime.destroy();
  });
});

/**
 * Z30: the message used to be spoken by the renderer, before the write knew
 * whether the pairing would succeed — so while the placeholder was written
 * over the image, the console said "keeping what the server rendered". The
 * verdict now comes after the write, in two texts, and `inspect()` counts it.
 */
describe('a Lexical block whose server markup the write loses', () => {
  /** The server dropped the empty outro paragraph: two live children against three rendered. */
  const DROPPED_PARAGRAPH =
    '<p>intro</p>' +
    '<figure class="mx-auto"><img src="https://cdn.example.com/a.jpg" alt="a"></figure>';

  it('says so (LP0413), not the opposite (LP0410), and counts the patch', async () => {
    document.body.innerHTML = `<div data-payload-field="content">${DROPPED_PARAGRAPH}</div>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: documentWith('edited') });
    await vi.advanceTimersByTimeAsync(50);

    const content = document.querySelector('[data-payload-field="content"]')!;
    expect(content.querySelectorAll('img')).toHaveLength(0);
    expect(content.querySelector('.lp-block--mediablock')).not.toBeNull();
    const warned = warn.mock.calls.map(String).join(' ');
    expect(warned).toContain('LP0413');
    expect(warned).toContain('"mediaBlock"');
    expect(warned).not.toContain('LP0410');
    // Three facts a reader of the demo page needed and did not have: the patch
    // fell short, nobody was asked to redraw it, and there was nobody to ask.
    const { fidelity, route, fragments } = runtime.inspect();
    expect(fidelity).toEqual({
      mode: 'escalate',
      canEscalate: false,
      unfaithful: 1,
      escalated: 0,
      fields: ['content'],
    });
    expect(route.handler).toBe(false);
    expect(fragments.handler).toBe(false);
    warn.mockRestore();
    runtime.destroy();
  });

  it('hands the region to the route where there is one, and counts that too', async () => {
    document.body.innerHTML = `<div data-payload-field="content">${DROPPED_PARAGRAPH}</div>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const route = fakeRoute();
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers(), strategies: { route } });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: documentWith('edited') });
    await vi.advanceTimersByTimeAsync(50);

    expect(route.refreshes).toBe(1);
    expect(runtime.inspect().fidelity).toEqual({
      mode: 'escalate',
      canEscalate: true,
      unfaithful: 1,
      escalated: 1,
      fields: ['content'],
    });
    warn.mockRestore();
    runtime.destroy();
  });

  it('reports each verdict once per block, so a second edit repeats neither line', async () => {
    document.body.innerHTML = `<div data-payload-field="content">${DROPPED_PARAGRAPH}</div>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: documentWith('one') });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({ type: 'payload-live-preview', data: documentWith('two') });
    await vi.advanceTimersByTimeAsync(50);

    const lines = warn.mock.calls.map(String).filter((line) => line.includes('LP041'));
    expect(lines).toHaveLength(1);
    expect(runtime.inspect().fidelity.unfaithful).toBe(1);
    warn.mockRestore();
    runtime.destroy();
  });
});

/**
 * Z29, measured on the demo post after one edit to the title:
 *
 *   Server : div.mx-auto[1]( div.prose-h7[5]( p  figure.mx-auto[2]  h2  p  ul ) )
 *   Runtime: div.mx-auto[5]( p  div.lp-block--mediablock[0]  h2  p  ul )
 *   → imgs 1 → 0
 *
 * The site's `RichText` component wraps its output in the Tailwind `prose`
 * wrapper, so the bound element has one child where the rendered document has
 * five, and the positional pairing stopped before it reached the block. Z2's
 * fixture had no wrapper; this one does. The pairing now descends into the
 * wrapper — and the wrapper stays, because the typography hangs on its class.
 */
describe('a Lexical block inside the wrapper a template puts around rich text', () => {
  function mount(): { content: Element; wrapper: Element; figure: Element } {
    document.body.innerHTML = `<div class="mx-auto" data-payload-field="content">${DEMO_SERVER_MARKUP}</div>`;
    const content = document.querySelector('[data-payload-field="content"]')!;
    expect(shapeOf(content)).toBe(
      'div.mx-auto[1]( div.prose-h7[5]( p[0] figure.mx-auto[2]( img[0] figcaption[0] ) h2[0] p[0] ul[2]( li[0] li[0] ) ) )',
    );
    return {
      content,
      wrapper: content.querySelector('.prose-h7')!,
      figure: content.querySelector('figure')!,
    };
  }

  it('keeps the block, and the wrapper it stands in, across an edit to the title', async () => {
    const { content, wrapper, figure } = mount();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: demoDocument('Die Lichtprobe') });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({ type: 'payload-live-preview', data: demoDocument('Die Lichtprobe, neu') });
    await vi.advanceTimersByTimeAsync(50);

    // The measured server shape, unchanged — not "the image is back somewhere".
    expect(shapeOf(content)).toBe(
      'div.mx-auto[1]( div.prose-h7[5]( p[0] figure.mx-auto[2]( img[0] figcaption[0] ) h2[0] p[0] ul[2]( li[0] li[0] ) ) )',
    );
    expect(content.querySelectorAll('img')).toHaveLength(1);
    // The same elements, not equal ones: the wrapper was written into, the figure moved.
    expect(content.firstElementChild).toBe(wrapper);
    expect(content.querySelector('figure')).toBe(figure);
    const warned = warn.mock.calls.map(String).join(' ');
    expect(warned).toContain('LP0410');
    expect(warned).not.toContain('LP0413');
    // Nothing about the block fell short. The one finding is the edited field
    // itself: this page anchors `content` and nothing else, so `title` is a
    // change nothing binds — the other cause the same ledger counts, and
    // `escalated: 0` because there is no strategy here to hand it to.
    expect(runtime.inspect().fidelity).toEqual({
      mode: 'escalate',
      canEscalate: false,
      unfaithful: 1,
      escalated: 0,
      fields: ['title'],
    });
    warn.mockRestore();
    runtime.destroy();
  });

  it('keeps the wrapper on a write that has nothing to pair', async () => {
    const { content, wrapper } = mount();
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    const noBlock = demoDocument('Die Lichtprobe') as {
      content: { root: { children: unknown[] } };
    };
    noBlock.content.root.children.splice(1, 1);
    fireMessage({ type: 'payload-live-preview', data: noBlock });
    await vi.advanceTimersByTimeAsync(50);

    expect(content.firstElementChild).toBe(wrapper);
    expect(shapeOf(content)).toBe(
      'div.mx-auto[1]( div.prose-h7[4]( p[0] h2[0] p[0] ul[2]( li[0] li[0] ) ) )',
    );
    runtime.destroy();
  });

  it('loses the block, and says so, when the wrapper itself carries a binding', async () => {
    // A wrapper bound to another field is that field's element, not a shell
    // to write into; the pairing stops at the bound element as before.
    document.body.innerHTML =
      '<div data-payload-field="content">' +
      DEMO_SERVER_MARKUP.replace(
        '<div class="prose-h7">',
        '<div class="prose-h7" data-payload-field="other">',
      ) +
      '</div>';
    const content = document.querySelector('[data-payload-field="content"]')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: demoDocument('Die Lichtprobe') });
    await vi.advanceTimersByTimeAsync(50);

    expect(content.querySelectorAll('img')).toHaveLength(0);
    expect(warn.mock.calls.map(String).join(' ')).toContain('LP0413');
    expect(runtime.inspect().fidelity.unfaithful).toBe(1);
    warn.mockRestore();
    runtime.destroy();
  });
});
