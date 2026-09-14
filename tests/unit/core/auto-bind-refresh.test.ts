/**
 * What a server render does to a guessed binding (ADR 0014, Z26). A route
 * refresh morphs the page toward the server's own markup, and that markup
 * carries no stamp — so every guess the baseline made was gone after the first
 * refresh, and every later edit to a guessed field escalated to another one.
 * Measured here first, then closed: the runtime looks for the baseline's own
 * guesses again on the fresh markup, once per refresh, and for nothing else.
 *
 * A fragment render is the same morph on a smaller region, and it was left
 * open: the guesses inside the boundary went, and on a page with fragments and
 * no route strategy nothing ever brought them back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { fragmentStrategyFrom } from '@fragment/index';
import { createRouteStrategy } from '@fragment/route';
import { compareFidelity, reportDifferences } from '../../e2e/helpers/fidelity';
import { AUTO_BIND_TRAPS, editedFields, type AutoBindTrap } from '../../fixtures/auto-bind-traps';
import { post, startRuntime, type RuntimeHarness } from '../../helpers/runtime';

/** The runtime a test started; destroyed after it, so a failing test leaves no listener behind. */
let running: RuntimeHarness | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  running?.runtime.destroy();
  running = undefined;
  vi.useRealTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

const TITLE = 'Hello from the demo';
const SUBTITLE = 'A subtitle the template printed';
const KICKER = 'A kicker nothing on the page binds';

interface RefreshHarness extends RuntimeHarness {
  /** One call per route refresh the runtime actually made. */
  readonly fetch: ReturnType<typeof vi.fn>;
}

/**
 * The real route strategy against a server that renders `body()` for the
 * route: the same fetch, the same `DOMParser`, the same morph a page gets.
 */
function start(body: string, serve: () => string = () => body): RefreshHarness {
  document.body.innerHTML = body;
  const fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      text: () =>
        Promise.resolve(
          `<!doctype html><html><head><title>Page</title></head><body>${serve()}</body></html>`,
        ),
    } as unknown as Response),
  );
  const route = createRouteStrategy({
    fetch,
    minIntervalMs: 0,
    window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
  });
  const harness = startRuntime({
    renderers: buildBuiltinRenderers(),
    autoBind: 'unique',
    strategies: { route },
  });
  running = harness;
  return { ...harness, fetch };
}

/** One message per call, each given time for its refresh, its re-apply and the observer's rebuild. */
async function send(...messages: Record<string, unknown>[]): Promise<void> {
  for (const data of messages) {
    post(data);
    await vi.advanceTimersByTimeAsync(200);
  }
}

function guessedFields(harness: RuntimeHarness): string[] {
  return harness.runtime.inspect().bindings.guessed.map((guess) => guess.field);
}

describe('a guess after the route refreshed', () => {
  it('survives the refresh: the next edit to the guessed field is a patch, not another refresh', async () => {
    const harness = start(`<article><h1>${TITLE}</h1><p>${SUBTITLE}</p></article>`);

    await send({ title: TITLE, subtitle: SUBTITLE });
    expect(guessedFields(harness)).toEqual(['subtitle', 'title']);

    // A field nothing binds: escalation, one route refresh, the morph toward
    // markup with no stamp on it.
    await send({ title: TITLE, subtitle: SUBTITLE, kicker: KICKER });
    expect(harness.fetch).toHaveBeenCalledTimes(1);

    await send({ title: 'Edited after the refresh', subtitle: SUBTITLE, kicker: KICKER });

    // The finding, before the fix: `h1` still read the server's title, the
    // guesses were `[]`, and this edit had fetched the route a second time.
    expect(document.querySelector('h1')?.textContent).toBe('Edited after the refresh');
    expect(document.querySelector('h1')?.getAttribute('data-payload-guessed')).toBe(TITLE);
    expect(guessedFields(harness)).toEqual(['subtitle', 'title']);
    expect(harness.fetch).toHaveBeenCalledTimes(1);
    expect(harness.runtime.inspect().route).toMatchObject({ refreshes: 1, failed: 0 });
    harness.runtime.destroy();
  });

  it('follows the value, not the position: a sibling the server inserted does not take the guess', async () => {
    // The morph pairs unkeyed siblings of one kind by position. Keeping a
    // stamp through the morph would leave `subtitle` on the element that now
    // shows the kicker — a wrong write on every keystroke. Looking for the
    // value again lands on the element that shows it.
    let kicker = '';
    const harness = start(`<article><h1>${TITLE}</h1><p>${SUBTITLE}</p></article>`, () =>
      kicker.length === 0
        ? `<article><h1>${TITLE}</h1><p>${SUBTITLE}</p></article>`
        : `<article><h1>${TITLE}</h1><p class="kicker">${kicker}</p><p>${SUBTITLE}</p></article>`,
    );

    await send({ title: TITLE, subtitle: SUBTITLE });
    kicker = KICKER;
    await send({ title: TITLE, subtitle: SUBTITLE, kicker: KICKER });
    await send({ title: TITLE, subtitle: 'Edited after the refresh', kicker: KICKER });

    const paragraphs = Array.from(document.querySelectorAll('p'), (p) => p.textContent);
    expect(paragraphs).toEqual([KICKER, 'Edited after the refresh']);
    expect(document.querySelector('p.kicker')?.hasAttribute('data-payload-field')).toBe(false);
    expect(harness.fetch).toHaveBeenCalledTimes(1);
    harness.runtime.destroy();
  });

  it('finds the guess by the value the server rendered, whether the saved one or this revision’s', async () => {
    // A server with autosave renders the edited title; one without renders the
    // saved one. Both are looked for, so either render keeps the binding.
    let title = TITLE;
    const harness = start(
      `<article><h1>${TITLE}</h1><p>${SUBTITLE}</p></article>`,
      () => `<article><h1>${title}</h1><p>${SUBTITLE}</p></article>`,
    );

    await send({ title: TITLE, subtitle: SUBTITLE });
    title = 'Autosaved before the refresh';
    await send({ title, subtitle: SUBTITLE, kicker: KICKER });
    await send({ title: 'Edited after the refresh', subtitle: SUBTITLE, kicker: KICKER });

    expect(document.querySelector('h1')?.textContent).toBe('Edited after the refresh');
    expect(guessedFields(harness)).toEqual(['subtitle', 'title']);
    expect(harness.fetch).toHaveBeenCalledTimes(1);
    harness.runtime.destroy();
  });

  it('finds nothing new: a field the baseline did not bind stays unbound after the refresh', async () => {
    // The kicker's value now stands alone on the fresh page. The search after
    // a refresh is for the baseline's guesses, not a second baseline — ADR
    // 0014 §1 holds for everything the first message did not find.
    const harness = start(
      `<article><h1>${TITLE}</h1></article>`,
      () => `<article><p class="kicker">${KICKER}</p><h1>${TITLE}</h1></article>`,
    );

    await send({ title: TITLE });
    await send({ title: TITLE, kicker: KICKER });
    expect(harness.fetch).toHaveBeenCalledTimes(1);
    await send({ title: TITLE, kicker: 'Edited kicker, still unbound' });

    expect(guessedFields(harness)).toEqual(['title']);
    expect(document.querySelector('p.kicker')?.textContent).toBe(KICKER);
    expect(harness.fetch).toHaveBeenCalledTimes(2);
    harness.runtime.destroy();
  });

  it('binds nothing on any trap page, refresh included, and leaves the page as the server sent it', async () => {
    // F1 of the record, replayed through a refresh: the baseline found nothing
    // to keep, so the search after the refresh has nothing to look for.
    const bound: string[] = [];
    const replay = async (trap: AutoBindTrap): Promise<void> => {
      document.head.innerHTML = trap.head ?? '';
      const harness = start(trap.html);
      trap.mount?.(document.body);
      try {
        await send(trap.fields, { ...trap.fields, zzzUnbound: KICKER }, editedFields(trap.fields));
        const { guessed } = harness.runtime.inspect().bindings;
        const stamped = document.querySelectorAll('[data-payload-guessed]').length;
        const differences = compareFidelity(document.body.innerHTML, trap.html);
        if (guessed.length > 0 || stamped > 0 || differences.length > 0) {
          bound.push(
            `${trap.name}: guessed ${JSON.stringify(guessed)}, ${String(stamped)} stamped, ${reportDifferences(differences)}`,
          );
        }
      } finally {
        harness.runtime.destroy();
        document.head.innerHTML = '';
        document.body.innerHTML = '';
      }
    };
    for (const trap of AUTO_BIND_TRAPS) await replay(trap);
    expect(bound).toEqual([]);
  });
});

const TAGLINE = 'A tagline the boundary renders';

interface FragmentHarness extends RuntimeHarness {
  /** One call per boundary the handler rendered. */
  readonly render: ReturnType<typeof vi.fn>;
}

/**
 * A fragment strategy and no route strategy: the page where a stripped guess
 * had nothing to bring it back. The handler answers with `serve()`, markup
 * with no stamp on it, as a server's own template renders it.
 */
function startFragment(body: string, serve: () => string): FragmentHarness {
  document.body.innerHTML = body;
  const render = vi.fn(() => Promise.resolve({ status: 'rendered' as const, html: serve() }));
  const harness = startRuntime({
    renderers: buildBuiltinRenderers(),
    autoBind: 'unique',
    strategies: { fragment: fragmentStrategyFrom(render) },
  });
  running = harness;
  return { ...harness, render };
}

describe('a guess after a fragment rendered', () => {
  it('survives the render: the next edit to a guessed field in the boundary is a patch', async () => {
    let tagline = TAGLINE;
    const harness = startFragment(
      `<section data-payload-fragment="hero" data-payload-depends="tagline"><h1>${TITLE}</h1><p>${TAGLINE}</p></section>` +
        `<footer><p>${SUBTITLE}</p></footer>`,
      () => `<h1>${TITLE}</h1><p>${tagline}</p>`,
    );

    await send({ title: TITLE, tagline: TAGLINE, subtitle: SUBTITLE });
    expect(guessedFields(harness)).toEqual(['subtitle', 'tagline', 'title']);

    // A field the boundary depends on: the server renders the boundary, and
    // its markup has no stamp on the heading or the paragraph.
    tagline = 'A tagline the server rendered again';
    await send({ title: TITLE, tagline, subtitle: SUBTITLE });
    expect(harness.render).toHaveBeenCalled();

    const renders = harness.render.mock.calls.length;
    await send({ title: 'Edited after the render', tagline, subtitle: SUBTITLE });

    // The finding, before the fix: the heading still read the server's title
    // and carried no stamp, and nothing on this page would ever bind it again.
    const heading = document.querySelector('h1');
    expect(heading?.textContent).toBe('Edited after the render');
    expect(heading?.getAttribute('data-payload-guessed')).toBe(TITLE);
    expect(guessedFields(harness)).toEqual(['subtitle', 'tagline', 'title']);
    // The title is no dependency of the boundary, so the edit is a patch.
    expect(harness.render).toHaveBeenCalledTimes(renders);
    // The guess outside the boundary was never stripped, and is not doubled.
    expect(document.querySelector('footer p')?.getAttribute('data-payload-guessed')).toBe(SUBTITLE);
    expect(document.querySelectorAll('[data-payload-guessed]')).toHaveLength(3);
    harness.runtime.destroy();
  });

  it('finds nothing new: a value the render brought in stays unbound', async () => {
    // The render is not a second baseline either (ADR 0014 §1): the kicker
    // stands alone on the page after it, and still binds nothing.
    let kicker = '';
    const harness = startFragment(
      `<section data-payload-fragment="hero" data-payload-depends="kicker"><h1>${TITLE}</h1></section>`,
      () => `<h1>${TITLE}</h1>${kicker.length === 0 ? '' : `<p class="kicker">${kicker}</p>`}`,
    );

    await send({ title: TITLE });
    kicker = KICKER;
    await send({ title: TITLE, kicker: KICKER });
    expect(harness.render).toHaveBeenCalled();
    await send({ title: 'Edited after the render', kicker: KICKER });

    expect(guessedFields(harness)).toEqual(['title']);
    expect(document.querySelector('h1')?.textContent).toBe('Edited after the render');
    expect(document.querySelector('p.kicker')?.hasAttribute('data-payload-field')).toBe(false);
    harness.runtime.destroy();
  });
});
