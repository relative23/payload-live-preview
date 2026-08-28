/**
 * Reveal-edited-field target for reveal-nextjs.spec.ts. `heroTitle` is at the
 * top; `footer` sits below a viewport-plus spacer, off-screen on load. A test
 * frames this page, edits `footer`, and asserts the preview scrolled it into
 * view — the reveal feature exercised through the Next.js adapter (inline
 * mode), not Astro.
 */
export default function RevealPage() {
  return (
    <main style={{ margin: 0, font: '16px/1.5 system-ui, sans-serif' }}>
      <h1 data-payload-field="heroTitle" data-testid="hero">
        Top
      </h1>
      <div style={{ height: '2200px' }}>scroll down for the footer</div>
      <p data-payload-field="footer" data-testid="footer">
        old footer
      </p>
    </main>
  );
}
