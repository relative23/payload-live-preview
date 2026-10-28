import { describe, expect, it, vi } from 'vitest';
import type { RouteStrategy } from '@core/strategies';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/**
 * Under `subfieldCoverage: 'declared'` an edit inside a group is compared with
 * the previous message path by path. Measured on a site that merges with the
 * server: the admin posts the hero's upload as its id (`hero.media` = 2)
 * in every message, the merge answers with the document, and a keystroke inside
 * the merge window renders the message's own values before the answer lands.
 * The comparison met the document on one side and the id on the other, called
 * the upload changed and refreshed the route (LP0807) while the editor only
 * typed in the kicker; LP0203 named the document's fields (`hero.media.id`,
 * `hero.media.alt`) as if they were the group's.
 */

const MEDIA = { id: 2, alt: 'Plates on a table', url: '/api/media/file/plates.jpg' };

function message(kicker: string, media: unknown = 2): unknown {
  return {
    type: 'payload-live-preview',
    collectionSlug: 'posts',
    data: { id: 'post-1', title: 'Saved', hero: { kicker, media } },
  };
}

function setup(): {
  route: RouteStrategy & { refreshes: number };
  warnings: string[];
  fetchFn: ReturnType<typeof vi.fn<typeof fetch>>;
} {
  document.body.innerHTML =
    '<h1 data-payload-field="title">Saved</h1><p data-payload-field="hero.kicker">Kicker</p>';
  const route = {
    refreshes: 0,
    plan: (): boolean => false,
    refresh: (): Promise<'partial'> => {
      route.refreshes += 1;
      return Promise.resolve('partial');
    },
  };
  const warnings: string[] = [];
  const fetchFn = vi.fn<typeof fetch>((_input, init) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      data?: { hero?: { kicker?: string; media?: number } };
    };
    const hero = {
      kicker: body.data?.hero?.kicker,
      media: { ...MEDIA, id: body.data?.hero?.media },
    };
    return Promise.resolve(
      new Response(JSON.stringify({ id: 'post-1', title: 'Saved', hero }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  const runtime = makeRuntime({
    debounceMs: 50,
    subfieldCoverage: 'declared',
    strategies: { route },
    dataMerge: { serverURL: 'https://cms.example.com', fetchFn },
    warn: (line) => {
      warnings.push(String(line));
    },
  });
  runtime.start();
  return { route, warnings, fetchFn };
}

describe("subfieldCoverage: 'declared' and the merge that populates an upload", () => {
  it('does not refresh the route while the editor types beside the upload', async () => {
    const { route, fetchFn } = setup();
    fireMessage(message('K'));
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchFn).toHaveBeenCalledOnce();

    // Inside the merge window: rendered from the message, refined by the answer.
    fireMessage(message('Ki'));
    await vi.advanceTimersByTimeAsync(10);
    fireMessage(message('Kic'));
    await vi.advanceTimersByTimeAsync(200);

    expect(document.querySelector('p')?.textContent).toBe('Kic');
    expect(route.refreshes).toBe(0);
  });

  it('still refreshes the route when the editor picks another upload', async () => {
    const { route } = setup();
    fireMessage(message('K'));
    await vi.advanceTimersByTimeAsync(100);

    fireMessage(message('K', 3));
    await vi.advanceTimersByTimeAsync(200);

    expect(route.refreshes).toBe(1);
  });

  it('names the upload, not the fields of the document it holds, in LP0203', async () => {
    const { warnings } = setup();
    fireMessage(message('K'));
    await vi.advanceTimersByTimeAsync(100);
    fireMessage(message('Ki'));
    await vi.advanceTimersByTimeAsync(200);

    const unbound = warnings.filter((line) => line.includes('LP0203'));
    expect(unbound.some((line) => line.includes('"hero.media"'))).toBe(true);
    expect(unbound.filter((line) => line.includes('"hero.media.'))).toEqual([]);
  });
});
