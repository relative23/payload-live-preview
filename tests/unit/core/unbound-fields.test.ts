import { beforeEach, describe, expect, it } from 'vitest';
import { ElementCache } from '@core/cache';
import {
  createNameAddressability,
  createPathCoverage,
  declaredSubfields,
  hasBindingBelow,
  SYSTEM_FIELD_NAMES,
  unboundChangedFields,
  uncoveredDocumentPaths,
  uncoveredNamePaths,
} from '@core/unbound-fields';

/**
 * The addressability rule the unbound-change escalation, LP0203 and the
 * overlay share, asked directly: owner scope, locale suffixes, declared covers
 * and the declared mode's paths below a group (ADR 0022).
 */

function cacheOf(html: string): ElementCache {
  document.body.innerHTML = html;
  const cache = new ElementCache();
  cache.buildFromRoot(document.body);
  return cache;
}

const OWNED = (owner: string, inner: string): string =>
  `<section data-payload-owner="${owner}">${inner}</section>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the system fields every Payload document carries', () => {
  it('are exactly these, and none of them is ever unbound', () => {
    expect([...SYSTEM_FIELD_NAMES].sort()).toEqual([
      '_id',
      '_status',
      'collection',
      'createdAt',
      'createdBy',
      'globalType',
      'id',
      'locale',
      'localized',
      'updatedAt',
      'updatedBy',
    ]);
    const touched = new Set([...SYSTEM_FIELD_NAMES, 'title']);
    expect(unboundChangedFields(cacheOf(''), touched, undefined, false)).toEqual(['title']);
  });
});

describe('a binding below a field', () => {
  it('counts when one of several bindings is in scope', () => {
    const cache = cacheOf(
      OWNED('global:b', '<p data-payload-field="hero.eyebrow">b</p>') +
        OWNED('global:a', '<p data-payload-field="hero.eyebrow">a</p>'),
    );
    expect(hasBindingBelow(cache, 'hero', ['global:a'])).toBe(true);
    expect(createPathCoverage(cache, ['global:a']).covers('hero.eyebrow')).toBe(true);
    expect(createPathCoverage(cache, ['global:c']).covers('hero.eyebrow')).toBe(false);
  });

  it('counts only inside the update scope', () => {
    const cache = cacheOf(OWNED('global:a', '<p data-payload-field="hero.eyebrow">e</p>'));
    expect(hasBindingBelow(cache, 'hero', false)).toBe(true);
    expect(hasBindingBelow(cache, 'hero', ['global:a'])).toBe(true);
    expect(hasBindingBelow(cache, 'hero', ['global:b'])).toBe(false);
    expect(hasBindingBelow(cache, 'her', false)).toBe(false);
  });
});

describe('locale-suffixed names', () => {
  it('reach the base binding, and a binding that carries its own locale', () => {
    const cache = cacheOf(
      '<h1 data-payload-field="title">t</h1>' +
        '<p data-payload-field="hero.eyebrow">e</p>' +
        '<p data-payload-field="teaser" data-payload-locale="fr">f</p>',
    );
    const touched = new Set(['title_de', 'hero_de', 'teaser_fr', 'summary_de']);
    expect(unboundChangedFields(cache, touched, 'de', false)).toEqual(['summary_de']);
  });

  it('keep a localised binding of another document out of scope', () => {
    const cache = cacheOf(
      OWNED('global:b', '<p data-payload-field="teaser" data-payload-locale="fr">f</p>') +
        OWNED('global:a', '<h1 data-payload-field="title">t</h1>'),
    );
    expect(unboundChangedFields(cache, new Set(['teaser_fr']), 'de', ['global:a'])).toEqual([
      'teaser_fr',
    ]);
  });

  it('are compared below the top level under their base name', () => {
    const cache = cacheOf('<p data-payload-field="hero.eyebrow">e</p>');
    const subfields = {
      previous: { hero_de: { eyebrow: 'E', description: 'D' } },
      next: { hero_de: { eyebrow: 'E', description: 'D2' } },
    };
    expect(unboundChangedFields(cache, new Set(['hero_de']), 'de', false, subfields)).toEqual([
      'hero.description',
    ]);
  });
});

describe('declared covers', () => {
  it('cover the path, everything below it, and a base-named field', () => {
    const cache = cacheOf('<i data-payload-covers="seo, hero.note"></i>');
    const coverage = createPathCoverage(cache, false);
    expect(coverage.covers('seo')).toBe(true);
    expect(coverage.covers('seo.title')).toBe(true);
    expect(coverage.covers('seology')).toBe(false);
    expect(coverage.reachesBelow('hero')).toBe(true);
    expect(coverage.reachesBelow('hero.note')).toBe(false);
    expect(unboundChangedFields(cache, new Set(['seo_de', 'hero']), 'de', false)).toEqual([]);
  });

  it('cover only for the document their owner names', () => {
    const cache = cacheOf(OWNED('global:b', '<i data-payload-covers="seo"></i>'));
    expect(createPathCoverage(cache, ['global:b']).covers('seo')).toBe(true);
    expect(createPathCoverage(cache, ['global:a']).covers('seo')).toBe(false);
  });
});

describe('the declared mode', () => {
  it('applies only when asked and both messages are there', () => {
    const previous = { a: 1 };
    const next = { a: 2 };
    expect(declaredSubfields('descendant', previous, next)).toBeUndefined();
    expect(declaredSubfields('declared', undefined, next)).toBeUndefined();
    expect(declaredSubfields('declared', previous, undefined)).toBeUndefined();
    expect(declaredSubfields('declared', previous, next)).toEqual({ previous, next });
  });

  it('leaves a field alone that is bound whole or reached by nothing', () => {
    const cache = cacheOf(
      '<h1 data-payload-field="title">t</h1><p data-payload-field="hero.eyebrow">e</p>',
    );
    const subfields = {
      previous: { title: 'a', footer: { x: 1 }, hero: { eyebrow: 'E', note: 'N' } },
      next: { title: 'b', footer: { x: 2 }, hero: { eyebrow: 'E', note: 'N2' } },
    };
    const touched = new Set(['title', 'footer', 'hero']);
    expect(unboundChangedFields(cache, touched, undefined, false, subfields)).toEqual([
      'footer',
      'hero.note',
    ]);
    expect(unboundChangedFields(cache, touched, undefined, false)).toEqual(['footer']);
  });

  it('asks the same of a document for LP0203, skipping system fields', () => {
    const cache = cacheOf('<p data-payload-field="hero.eyebrow">e</p>');
    const fields = { id: { a: 1 }, title: 't', hero: { eyebrow: 'E', note: 'N' } };
    expect(uncoveredDocumentPaths(cache, fields, undefined, false)).toEqual([
      { path: 'hero.note', value: 'N' },
    ]);
  });
});

describe('the same rule from names alone', () => {
  it('honours covers, base names and paths below a group', () => {
    const addressable = createNameAddressability(['hero.eyebrow'], 'de', ['seo']);
    expect(addressable('hero')).toBe(true);
    expect(addressable('seo_de')).toBe(true);
    expect(addressable('seo.title')).toBe(true);
    expect(addressable('footer')).toBe(false);
    expect(addressable('footer_de')).toBe(false);
  });

  it('lists the uncovered paths inside partly reached groups only', () => {
    const fields = {
      _id: { a: 1 },
      seo: { title: 's' },
      footer: { x: 1 },
      hero: { eyebrow: 'E', note: 'N', cta: 'C' },
      // A system field stays out even where a page binds inside it.
      createdBy: { email: 'e', name: 'n' },
    };
    const bound = ['hero.eyebrow', 'createdBy.email'];
    expect(uncoveredNamePaths(fields, bound, undefined, ['seo', 'hero.cta'])).toEqual([
      'hero.note',
    ]);
  });
});
