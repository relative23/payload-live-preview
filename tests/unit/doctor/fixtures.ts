import type { DoctorProbe, DoctorResponse } from '@doctor/types';

/** A stand-in for the inline runtime: only the config marker, no runtime body. */
export const RUNTIME =
  '<script>var __LIVE_PREVIEW_CONFIG__=[["https://cms.example.com"]];</script>';
export const ADMIN = 'https://cms.example.com';
export const context = { url: 'https://example.com/', adminOrigin: ADMIN };

export function response(overrides: Partial<DoctorResponse> = {}): DoctorResponse {
  return { status: 200, headers: {}, body: '<html><body></body></html>', ...overrides };
}

/** A deployment with nothing wrong with it. */
export function healthy(): DoctorProbe {
  return {
    publicResponse: response({ body: '<h1>Title</h1>' }),
    previewResponse: response({
      headers: { 'content-security-policy': `frame-ancestors 'self' ${ADMIN}` },
      body: `${RUNTIME}<h1 data-payload-field="title">Title</h1>`,
    }),
  };
}

/** The healthy deployment with a different preview response. */
export function withPreview(
  body: string,
  headers: Record<string, string> = {
    'content-security-policy': `frame-ancestors 'self' ${ADMIN}`,
  },
): DoctorProbe {
  return { ...healthy(), previewResponse: response({ headers, body }) };
}
