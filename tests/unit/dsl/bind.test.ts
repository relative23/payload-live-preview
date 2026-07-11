import { describe, expect, it } from 'vitest';
import { bind, bindByPath } from '@dsl/bind';

interface Homepage {
  heroTitle: string;
  heroTagline: string;
  heroSubtitle: string;
  heroImage?: { src: string; alt?: string };
  slides?: readonly { id: string; title: string }[];
  meta?: { description: string };
}

describe('bind() — string-literal form', () => {
  it('emits the data-payload-field attribute', () => {
    expect(bind<Homepage>('heroTitle')).toEqual({ 'data-payload-field': 'heroTitle' });
  });

  it('threads the attribute option through', () => {
    expect(bind<Homepage>('heroTitle', { attribute: 'aria-label' })).toEqual({
      'data-payload-field': 'heroTitle',
      'data-payload-attribute': 'aria-label',
    });
  });

  it('threads the type override', () => {
    expect(bind<Homepage>('heroTitle', { type: 'html' })).toEqual({
      'data-payload-field': 'heroTitle',
      'data-payload-type': 'html',
    });
  });

  it('emits all three attributes when both options are present', () => {
    expect(bind<Homepage>('heroImage', { attribute: 'src', type: 'image' })).toEqual({
      'data-payload-field': 'heroImage',
      'data-payload-attribute': 'src',
      'data-payload-type': 'image',
    });
  });

  it('rejects empty field names at runtime', () => {
    expect(() => bind('')).toThrow(/non-empty/);
  });

  it('accepts arbitrary strings when no generic is provided', () => {
    expect(bind('custom-field')).toEqual({ 'data-payload-field': 'custom-field' });
  });
});

describe('bindByPath() — proxy form', () => {
  it('records a single property access', () => {
    expect(bindByPath<Homepage>((d) => d.heroTitle)).toEqual({
      'data-payload-field': 'heroTitle',
    });
  });

  it('records nested property accesses with dots', () => {
    expect(bindByPath<Homepage>((d) => d.heroImage?.src)).toEqual({
      'data-payload-field': 'heroImage.src',
    });
  });

  it('strips numeric indices from array accesses', () => {
    expect(bindByPath<Homepage>((d) => d.slides?.[0]?.title)).toEqual({
      'data-payload-field': 'slides.title',
    });
  });

  it('threads bind options through', () => {
    expect(
      bindByPath<Homepage>((d) => d.heroImage?.src, { attribute: 'src', type: 'image' }),
    ).toEqual({
      'data-payload-field': 'heroImage.src',
      'data-payload-attribute': 'src',
      'data-payload-type': 'image',
    });
  });

  it('throws when the picker reads nothing', () => {
    expect(() => bindByPath<Homepage>(() => 'constant')).toThrow(/did not read any field/);
  });

  it('still captures the path even if the picker throws partway', () => {
    expect(
      bindByPath<Homepage>((d) => {
        // Force a throw after reading the first field — runtime should
        // keep `heroTitle` and bail gracefully.
        void d.heroTitle;
        throw new Error('boom');
      }),
    ).toEqual({ 'data-payload-field': 'heroTitle' });
  });
});
