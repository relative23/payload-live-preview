/**
 * The boundary's content: what a patch cannot do. A section that exists only
 * when `subtitle` is set, and a value derived from `body` rather than bound to
 * a field. The bindings inside stay the fallback — when the endpoint cannot
 * render, the runtime patches them from the same revision.
 */
import type { HeroDocument } from './document';

export function Hero({ title, subtitle, body, words }: HeroDocument) {
  return (
    <>
      <h1 data-payload-field="title" data-testid="hero-title">
        {title}
      </h1>
      {subtitle !== undefined && (
        <p className="lede" data-testid="hero-subtitle">
          {subtitle}
        </p>
      )}
      <p data-payload-field="body" data-testid="hero-body">
        {body}
      </p>
      <p data-testid="hero-words">{words} words</p>
      <input id="hero-input" data-testid="hero-input" aria-label="Scratch" />
    </>
  );
}
