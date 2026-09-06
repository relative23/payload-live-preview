/**
 * Fixture endpoint: mint a preview token for `?path=`. In a real deployment the
 * Payload side mints it and this route does not exist — one that hands tokens
 * to anyone would defeat the point.
 */
import { issuePreviewToken } from 'payload-live-preview/server';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from '../../lib/preview';

export default defineEventHandler(async (event) => {
  const path = String(getQuery(event)['path'] ?? '/');
  return await issuePreviewToken(
    { audience: PREVIEW_AUDIENCE, path, subject: 'editor', ttlMs: 10 * 60_000 },
    { secret: PREVIEW_TOKEN_SECRET },
  );
});
