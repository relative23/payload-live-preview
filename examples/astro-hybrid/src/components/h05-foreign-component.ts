/**
 * A tiny synthetic framework component lets H05 exercise Astro's renderer
 * registry without adding React, Vue or another framework to this fixture.
 */
import type { AstroContainerOptions } from 'astro/container';

const RENDERER_NAME = 'h05-fixture-renderer';
const ASTRO_RENDERER = Symbol.for('astro:renderer');

export function H05ForeignComponent(_props: { readonly label: string }): null {
  return null;
}

Object.defineProperty(H05ForeignComponent, ASTRO_RENDERER, { value: RENDERER_NAME });

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const h05Renderer: NonNullable<AstroContainerOptions['renderers']>[number] = {
  name: RENDERER_NAME,
  ssr: {
    check: (component) => Promise.resolve(component === H05ForeignComponent),
    renderToStaticMarkup: (_component, props) =>
      Promise.resolve({
        html: `<strong data-testid="h05-foreign-result">${escapeHtml((props as { label?: unknown }).label)}</strong>`,
      }),
  },
};
