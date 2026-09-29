/**
 * The `authorizePreview` hook, by module reference (ADR 0024): the
 * integration serializes its options, so it imports this file instead of
 * carrying the function. A request is a preview only with a valid token.
 */
import { authorizePreviewRequest } from 'payload-live-preview';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from './settings';

export default (request: Request) =>
  authorizePreviewRequest(request, {
    type: 'signed-token',
    secret: PREVIEW_TOKEN_SECRET,
    audience: PREVIEW_AUDIENCE,
  });
