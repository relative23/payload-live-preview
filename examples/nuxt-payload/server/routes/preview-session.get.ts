/**
 * Fixture endpoint: hand the caller a preview session, a signed token in a
 * cookie. The mock admin (`public/admin.html`) asks for one before it frames a
 * page. In a real deployment the Payload side mints the token and this route
 * does not exist: one that hands a session to anyone would defeat the point.
 */
import { issuePreviewToken } from 'payload-live-preview/server';
import { PREVIEW_AUDIENCE, PREVIEW_COOKIE, PREVIEW_TOKEN_SECRET } from '../../lib/preview';

export default defineEventHandler(async (event) => {
  // No path claim: a cookie is sent to every path of the origin, so a path
  // binding would only be true of whichever page happened to be framed first.
  const token = await issuePreviewToken(
    { audience: PREVIEW_AUDIENCE, subject: 'editor', ttlMs: 10 * 60_000 },
    { secret: PREVIEW_TOKEN_SECRET },
  );
  setCookie(event, PREVIEW_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
  setResponseStatus(event, 204);
  return null;
});
