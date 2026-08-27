/**
 * Fixture endpoint: mint a preview token for `?path=`. In a real deployment
 * the Payload side mints inside `livePreview.url` and this route does not
 * exist — an endpoint that hands out tokens to anyone would defeat the
 * point. It is here only because the example has no Payload behind it.
 */
import { issuePreviewToken } from 'payload-live-preview';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from '$lib/preview';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const path = url.searchParams.get('path') ?? '/';
  const token = await issuePreviewToken(
    { audience: PREVIEW_AUDIENCE, path, ttlMs: 10 * 60_000 },
    { secret: PREVIEW_TOKEN_SECRET },
  );
  return new Response(token, { headers: { 'content-type': 'text/plain' } });
};
