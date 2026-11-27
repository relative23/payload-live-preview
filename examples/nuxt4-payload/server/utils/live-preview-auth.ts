/**
 * The preview hook, registered by reference (ADR 0024). Against a real Payload
 * admin (tests/real-payload, `PLP_PAYLOAD_SERVER_URL`) the editor's own session
 * reaches this site and the documented `payload-session` strategy asks the
 * admin who it is. Without one, a signed token decides: the route-bound one in
 * the framed URL (`previewToken`, as `/hybrid-host` frames it), or the mock
 * admin's session, which `/preview-session` put in a cookie.
 */
import { authorizePreviewRequest, type PreviewAuthorization } from 'payload-live-preview/server';
import { PREVIEW_AUDIENCE, PREVIEW_COOKIE, PREVIEW_TOKEN_SECRET } from '../../lib/preview.ts';

/**
 * The header the cookie's token is handed to the strategy through. Nothing
 * sends it over the wire: it is the transport the verification uses once the
 * value has been taken out of the cookie.
 */
const TOKEN_HEADER = 'x-preview-token';

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export default (request: Request): PreviewAuthorization | Promise<PreviewAuthorization> => {
  const serverURL = process.env['PLP_PAYLOAD_SERVER_URL'];
  if (serverURL) return authorizePreviewRequest(request, { type: 'payload-session', serverURL });
  const strategy = {
    type: 'signed-token',
    secret: PREVIEW_TOKEN_SECRET,
    audience: PREVIEW_AUDIENCE,
  } as const;
  // The token in the URL is bound to its route, so it is the one to verify where it is given.
  if (new URL(request.url).searchParams.has('previewToken')) {
    return authorizePreviewRequest(request, strategy);
  }
  const token = cookieValue(request.headers.get('cookie'), PREVIEW_COOKIE);
  if (token === null) return { authorized: false, outcome: 'missing-credential', context: null };
  return authorizePreviewRequest(
    { url: request.url, headers: new Headers({ [TOKEN_HEADER]: token }) },
    { ...strategy, transport: { kind: 'header', name: TOKEN_HEADER } },
  );
};
