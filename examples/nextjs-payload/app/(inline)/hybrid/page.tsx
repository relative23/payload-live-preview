/**
 * The preview target for the fragment strategy, framed by ./host. The boundary
 * is rendered by the server on every revision; the footer outside it keeps
 * being patched in place, so one page shows both strategies at once.
 */
import { Hero } from './Hero';
import { heroProps, initialDocument } from './document';

export default function HybridPage() {
  return (
    <main>
      <section data-payload-fragment="hero" data-payload-depends="title,subtitle,body">
        <Hero {...heroProps({ ...initialDocument })} />
      </section>
      <footer data-payload-field="footer" data-testid="footer">
        patched, not rendered
      </footer>
    </main>
  );
}
