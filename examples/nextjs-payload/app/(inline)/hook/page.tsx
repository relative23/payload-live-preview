/**
 * The React hook against a real Payload admin (tests/real-payload): this page
 * renders from `useLivePreviewDocument`, not from bindings the DOM runtime
 * patches, so the hook's own session is what the real admin's messages reach.
 * `PLP_PAYLOAD_SERVER_URL` names the admin: it is both the origin the hook
 * accepts and the server it re-fetches the merged document from.
 */
import { HookPreview } from './HookPreview';

export default function Page() {
  const admin = process.env['PLP_PAYLOAD_SERVER_URL'] ?? '';
  return (
    <HookPreview
      serverURL={admin}
      allowedOrigins={admin === '' ? [] : [admin]}
      initialData={{ title: 'Hook initial title', subtitle: 'Hook initial subtitle' }}
    />
  );
}
