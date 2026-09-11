/**
 * Entering the preview: mint a token, put it where the layout can read it, and
 * send the browser on to the page it asked for.
 *
 * In a real deployment this route does not exist — the Payload side mints
 * inside `livePreview.url`, and an endpoint that hands a preview credential to
 * anyone would defeat the point. It is here because the example has no Payload
 * behind it, and because a cookie can only be written by a response: the mock
 * admin is a static file in `public/`, and the fragment host is a server
 * component, so neither can set one by itself.
 *
 * `to` selects the framed page and is never trusted as written. Only a path
 * from `ROUTES` is redirected to, and only the query of the request is carried
 * along with it, so a crafted `to` has no way to become an off-site redirect.
 */
import { PREVIEW_COOKIE, mintSessionToken } from '../preview';

/** The pages this fixture frames. `/asset` is not here: its layout is not gated. */
const ROUTES = ['/', '/reveal', '/hybrid'];

export async function GET(request: Request): Promise<Response> {
  const requested = new URL(request.url).searchParams.get('to') ?? '/';
  // Parsed against the site so a `//host` or `https://host` value resolves to a
  // pathname we then have to find in the list — it will not be there.
  const parsed = new URL(requested, 'http://localhost:4174');
  const route = ROUTES.find((candidate) => candidate === parsed.pathname) ?? '/';
  const token = await mintSessionToken();
  return new Response(null, {
    status: 302,
    headers: {
      location: `${route}${parsed.search}`,
      'set-cookie': `${PREVIEW_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
      // The token is one editor's credential; no shared cache may keep it.
      'cache-control': 'private, no-store',
    },
  });
}
