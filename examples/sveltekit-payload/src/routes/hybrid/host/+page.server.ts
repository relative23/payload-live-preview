/**
 * The host: what the Payload admin does. It mints a signed token for the route
 * it frames — `?unauthorized=1` deliberately omits it — and the test posts
 * updates into the frame. Unlike `/admin.html` it has no form of its own, so
 * nothing competes with the test's own messages.
 */
import { issuePreviewToken } from 'payload-live-preview';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from '$lib/preview';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  if (url.searchParams.get('unauthorized') === '1') return { src: '/hybrid?preview=true' };
  const token = await issuePreviewToken(
    { audience: PREVIEW_AUDIENCE, path: '/hybrid', subject: 'editor' },
    { secret: PREVIEW_TOKEN_SECRET },
  );
  return { src: `/hybrid?preview=true&previewToken=${encodeURIComponent(token)}` };
};
