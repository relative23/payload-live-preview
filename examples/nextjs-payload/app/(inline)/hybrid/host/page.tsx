/**
 * The host: what the Payload admin does. It frames the preview through
 * `/preview-session`, which writes the cookie the root layout's
 * `authorizePreview` reads, and appends the route-bound token the fragment
 * endpoint verifies on every boundary render.
 *
 * `?unauthorized=1` omits that second token and only that one: the page still
 * gets the runtime, so the fragment request is the thing being refused rather
 * than the preview as a whole.
 */
import { mintRouteToken } from '../../../preview';

export const dynamic = 'force-dynamic';

export default async function HybridHost({
  searchParams,
}: {
  searchParams: Promise<{ unauthorized?: string }>;
}) {
  const { unauthorized } = await searchParams;
  const token = unauthorized === '1' ? undefined : await mintRouteToken('/hybrid');
  const framed = `/hybrid?preview=true${token !== undefined ? `&previewToken=${token}` : ''}`;
  const src = `/preview-session?to=${encodeURIComponent(framed)}`;
  return (
    <iframe
      id="preview"
      data-testid="preview-frame"
      title="Preview"
      src={src}
      style={{ width: '800px', height: '600px', border: 0, display: 'block' }}
    />
  );
}
