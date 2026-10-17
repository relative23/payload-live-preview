/**
 * The `authorizePreview` hook of docs/authorization.md, by module reference
 * (ADR 0024): a request is a preview only when it carries the editor's own
 * Payload session, which the site checks against the admin's `/api/users/me`.
 * `astro.config.mjs` names this file instead of `./authorize.ts` when
 * PLP_PAYLOAD_SERVER_URL names the admin that frames the site (tests/real-payload).
 */
import { authorizePreviewRequest } from 'payload-live-preview/server';

const serverURL = process.env['PLP_PAYLOAD_SERVER_URL'];
if (serverURL === undefined || serverURL === '') {
  throw new Error('authorize-session: PLP_PAYLOAD_SERVER_URL names the Payload admin to ask.');
}

export default (request: Request) =>
  authorizePreviewRequest(request, { type: 'payload-session', serverURL });
