/**
 * The query selects fresh server markup on one authorized pathname. A slow
 * candidate lets the browser prove that a later navigation wins cleanly.
 */

import { createPreviewBindings } from 'payload-live-preview';
import type { PageServerLoad } from './$types';

const STEPS = new Set(['one', 'two', 'slow', 'stream', 'final', 'off']);

export const load: PageServerLoad = async ({ locals, url }) => {
  const requested = url.searchParams.get('step') ?? 'one';
  const step = STEPS.has(requested) ? requested : 'one';
  if (step === 'slow') await new Promise((resolve) => setTimeout(resolve, 400));

  const preview = createPreviewBindings({
    authorization: locals.livePreviewAuthorization ?? null,
    owner: 'collection:pages',
  });
  const streamedTitle =
    step === 'stream'
      ? new Promise<string>((resolve) => {
          setTimeout(() => resolve('Server title for stream'), 800);
        })
      : Promise.resolve(`Server title for ${step}`);
  const destination = (next: string): string => {
    const search = new URLSearchParams(url.searchParams);
    search.set('step', next);
    return `/navigation?${search.toString()}`;
  };

  return {
    bindings: { owner: preview.owner(), title: preview.bind('title') },
    bridge: step !== 'off',
    generation: `${step}:${crypto.randomUUID()}`,
    links: {
      two: destination('two'),
      slow: destination('slow'),
      stream: destination('stream'),
      final: destination('final'),
      off: destination('off'),
    },
    step,
    streamedTitle,
  };
};
