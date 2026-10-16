/**
 * A route refresh morphs the page body, so it follows the same island rules
 * as a fragment (ADR 0021): a kept island takes the refreshed props from
 * Astro's handoff and a removed one releases its framework root.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRouteStrategy } from '@fragment/index';
import type { RouteContext } from '@core/strategies';

const titles: unknown[] = [];
const unmounted: Element[] = [];

class StandInIsland extends HTMLElement {
  static observedAttributes = ['props'];
  started = false;

  start(): void {
    this.started = true;
    this.addEventListener('astro:unmount', () => unmounted.push(this), { once: true });
    this.hydrate();
  }

  hydrate(): void {
    if (!this.started || !this.isConnected) return;
    if (this.hasAttribute('ssr')) {
      titles.push((JSON.parse(this.getAttribute('props') ?? '{}') as { title?: unknown }).title);
    }
    this.removeAttribute('ssr');
  }

  attributeChangedCallback(): void {
    this.hydrate();
  }
}

function island(title: string, component = '/_astro/Panel.js'): string {
  return (
    `<astro-island component-url="${component}" renderer-url="/_astro/client.js" client="load" ` +
    `opts='{"name":"Panel","value":true}' ssr props='{"title":"${title}"}'><h3>${title}</h3></astro-island>`
  );
}

function context(): RouteContext {
  return {
    revision: 2,
    receivedAt: 1,
    signal: new AbortController().signal,
    isCurrent: () => true,
    log: () => undefined,
  };
}

function refreshWith(body: string) {
  return createRouteStrategy({
    fetch: vi.fn(() =>
      Promise.resolve(
        new Response(`<!doctype html><html><head></head><body>${body}</body></html>`, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    ),
    location: { href: 'https://site.example.com/page?preview=true' },
    window: { scrollX: 0, scrollY: 0, scrollTo: () => undefined },
  });
}

function mount(body: string): StandInIsland {
  document.body.innerHTML = body;
  const found = document.querySelector('astro-island');
  if (!(found instanceof StandInIsland)) throw new Error('island not upgraded');
  found.start();
  return found;
}

beforeAll(() => {
  customElements.define('astro-island', StandInIsland);
});

afterEach(() => {
  document.body.replaceChildren();
  titles.length = 0;
  unmounted.length = 0;
});

describe('route refresh and Astro islands', () => {
  it('hands refreshed props to the island it keeps', async () => {
    const kept = mount(`<main>${island('Saved')}</main>`);

    expect(await refreshWith(`<main>${island('Refreshed')}</main>`).refresh(context())).toBe(
      'partial',
    );

    expect(document.querySelector('astro-island')).toBe(kept);
    expect(titles).toEqual(['Saved', 'Refreshed']);
    expect(unmounted).toEqual([]);
  });

  it('releases an island the refreshed page replaced with another component', async () => {
    const old = mount(`<main>${island('Saved')}</main>`);

    await refreshWith(`<main>${island('Other', '/_astro/Other.js')}</main>`).refresh(context());

    expect(old.isConnected).toBe(false);
    expect(unmounted).toEqual([old]);
  });
});
