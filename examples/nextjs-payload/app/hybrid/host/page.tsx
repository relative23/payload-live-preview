/**
 * The host: what the Payload admin does. It mints a signed token for the route
 * it frames — `?unauthorized=1` deliberately omits it — and posts updates into
 * the frame from the test.
 */
import { mintToken } from '../preview';

export const dynamic = 'force-dynamic';

export default async function HybridHost({
  searchParams,
}: {
  searchParams: Promise<{ unauthorized?: string }>;
}) {
  const { unauthorized } = await searchParams;
  const token = unauthorized === '1' ? undefined : await mintToken('/hybrid');
  const src = `/hybrid?preview=true${token !== undefined ? `&previewToken=${token}` : ''}`;
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
