/**
 * The host for the asset-delivery page: it frames `/asset?preview=true` so the
 * bootstrap sees a preview context and fetches the runtime. The mock admin
 * frames `/` instead, which is the inline half of the fixture.
 */
export default function AssetHost() {
  return (
    <iframe
      id="preview"
      data-testid="preview-frame"
      title="Preview"
      src="/asset?preview=true"
      style={{ width: '800px', height: '600px', border: 0, display: 'block' }}
    />
  );
}
