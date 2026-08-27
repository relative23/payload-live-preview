import { createLivePreviewMiddleware } from 'payload-live-preview/astro';
import { authorizePreviewRequest } from 'payload-live-preview/server';
import { ADMIN_ORIGINS, strategy } from './preview';

export const onRequest = createLivePreviewMiddleware({
  allowedOrigins: ADMIN_ORIGINS,
  authorizePreview: (request) => authorizePreviewRequest(request, strategy),
  fragments: { endpoint: '/payload/fragment' },
  debug: true,
  debounceMs: 25,
});
