import {
  authorizePreviewRequest,
  type PreviewAuthorization,
  type PreviewAuthorizationRequest,
} from '@security/preview-authorization';

/**
 * A hook that authorizes every request, for the cases that are about what an
 * adapter does once a preview is authorized. Since 3.0 no policy starts
 * without a hook (ADR 0007, row 36), so a case that is not about the verdict
 * still has to name one.
 */
export const authorizeAll = (request: PreviewAuthorizationRequest): Promise<PreviewAuthorization> =>
  authorizePreviewRequest(request, { type: 'verifier', verify: () => ({ subject: 'editor' }) });

/** What every policy needs since 3.0, for a case that names neither: a hook and the admin's origin. */
export const AUTHORIZED = {
  authorizePreview: authorizeAll,
  allowedOrigins: ['https://admin.example.com'],
} as const;
