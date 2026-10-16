/**
 * The preview hook for a real Payload admin (tests/real-payload): the editor's
 * own session reaches this site, and the documented `payload-session` strategy
 * asks the admin who it is. Registered by reference (ADR 0024) only when
 * `PLP_PAYLOAD_SERVER_URL` names the admin; otherwise the fixture keeps the 1.x
 * profile its mock-admin specs run on.
 */
import { authorizePreviewRequest } from 'payload-live-preview/server';

export default (request: Request) =>
  authorizePreviewRequest(request, {
    type: 'payload-session',
    serverURL: process.env['PLP_PAYLOAD_SERVER_URL'] ?? '',
  });
