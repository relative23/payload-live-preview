import { describe, expect, it, vi } from 'vitest';
import {
  FieldRevealer,
  isInViewport,
  prefersReducedMotion,
  revealElement,
  type RevealElement,
  type RevealWindow,
} from '@core/reveal';

const win = (over: Partial<RevealWindow> = {}): RevealWindow => ({
  innerHeight: 800,
  innerWidth: 1200,
  ...over,
});

function el(rect: Partial<DOMRect>): RevealElement & { scrolled: number } {
  const target = {
    scrolled: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 10, right: 200, ...rect }) as DOMRect,
    scrollIntoView: () => {
      target.scrolled += 1;
    },
  };
  return target;
}

describe('isInViewport', () => {
  it('is true for an element on screen and false for one below the fold', () => {
    expect(isInViewport(el({ top: 100, bottom: 140, left: 10, right: 200 }), win())).toBe(true);
    expect(isInViewport(el({ top: 2000, bottom: 2040, left: 10, right: 200 }), win())).toBe(false);
    expect(isInViewport(el({ top: -80, bottom: -40, left: 10, right: 200 }), win())).toBe(false);
  });
});

describe('prefersReducedMotion', () => {
  it('reads the media query and tolerates a throwing matchMedia', () => {
    expect(prefersReducedMotion(win({ matchMedia: () => ({ matches: true }) }))).toBe(true);
    expect(prefersReducedMotion(win({ matchMedia: () => ({ matches: false }) }))).toBe(false);
    expect(prefersReducedMotion(win())).toBe(false); // no matchMedia
  });
});

describe('revealElement', () => {
  it('scrolls an off-screen element and leaves a visible one alone', () => {
    const off = el({ top: 2000, bottom: 2040 });
    expect(revealElement(off, win())).toBe('revealed');
    expect(off.scrolled).toBe(1);

    const on = el({ top: 100, bottom: 140 });
    expect(revealElement(on, win())).toBe('already-visible');
    expect(on.scrolled).toBe(0);
  });

  it('uses auto behavior under reduced motion, smooth otherwise', () => {
    const target = el({ top: 2000, bottom: 2040 });
    const spy = vi.spyOn(target, 'scrollIntoView');
    revealElement(target, win({ matchMedia: () => ({ matches: true }) }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    revealElement(el({ top: 2000, bottom: 2040 }), win());
  });
});

describe('FieldRevealer', () => {
  it('reveals a new field but skips the same field on the next call', () => {
    const r = new FieldRevealer();
    const off = el({ top: 2000, bottom: 2040 });
    expect(r.reveal('title', off, win())).toBe('revealed');
    expect(r.reveal('title', el({ top: 2000, bottom: 2040 }), win())).toBe('skipped-same');
    expect(r.reveal('body', el({ top: 2000, bottom: 2040 }), win())).toBe('revealed');
  });

  it('reset() lets the same field reveal again', () => {
    const r = new FieldRevealer();
    r.reveal('title', el({ top: 2000, bottom: 2040 }), win());
    r.reset();
    expect(r.reveal('title', el({ top: 2000, bottom: 2040 }), win())).toBe('revealed');
  });
});
