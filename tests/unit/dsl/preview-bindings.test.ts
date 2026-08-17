import { describe, expect, it } from 'vitest';
import { createPreviewBindings } from '@dsl/preview-bindings';

interface Homepage {
  heroTitle: string;
  intro: string;
}

/** Every attribute this package can put into markup starts with this prefix. */
function payloadAttributes(record: object): string[] {
  return Object.keys(record).filter((key) => key.startsWith('data-payload-'));
}

describe('createPreviewBindings — unauthorized', () => {
  const preview = createPreviewBindings({ authorized: false, owner: 'global:homepage' });

  it('emits nothing for a plain field', () => {
    expect(preview.bind<Homepage>('heroTitle')).toEqual({});
  });

  it('emits nothing for a path binding', () => {
    expect(preview.bindByPath<Homepage>((d) => d.intro)).toEqual({});
  });

  it('emits no owner, which would otherwise disclose the document identity', () => {
    expect(preview.owner()).toEqual({});
    expect(
      createPreviewBindings({ authorized: false, owner: 'collection:services:73' }).owner(),
    ).toEqual({});
  });

  it('suppresses every companion attribute with the field, never a subset', () => {
    const attrs = preview.bind<Homepage>('intro', {
      attribute: 'datetime',
      type: 'richText',
      richtext: true,
      html: true,
      locale: 'de',
    });

    // The original defect was a companion surviving its gated field.
    expect(payloadAttributes(attrs)).toEqual([]);
    expect(attrs).toEqual({});
  });

  it('reports the verdict it was built with', () => {
    expect(preview.authorized).toBe(false);
  });
});

describe('createPreviewBindings — authorized', () => {
  const preview = createPreviewBindings({ authorized: true, owner: 'global:homepage' });

  it('emits the field binding', () => {
    expect(preview.bind<Homepage>('heroTitle')).toEqual({ 'data-payload-field': 'heroTitle' });
  });

  it('emits the recorded path for a picker', () => {
    expect(preview.bindByPath<Homepage>((d) => d.intro)).toEqual({
      'data-payload-field': 'intro',
    });
  });

  it('emits the configured owner', () => {
    expect(preview.owner()).toEqual({ 'data-payload-owner': 'global:homepage' });
  });

  it('emits the complete companion set as one unit', () => {
    expect(
      preview.bind<Homepage>('intro', {
        attribute: 'datetime',
        type: 'date',
        richtext: true,
        html: true,
        locale: 'de-AT',
      }),
    ).toEqual({
      'data-payload-field': 'intro',
      'data-payload-attribute': 'datetime',
      'data-payload-type': 'date',
      'data-payload-richtext': '',
      'data-payload-html': '',
      'data-payload-locale': 'de-AT',
    });
  });

  it('omits presence attributes when they are explicitly false', () => {
    const attrs = preview.bind<Homepage>('intro', { richtext: false, html: false });
    expect(attrs).toEqual({ 'data-payload-field': 'intro' });
  });

  it('emits no owner when none was configured', () => {
    expect(createPreviewBindings({ authorized: true }).owner()).toEqual({});
    expect(createPreviewBindings({ authorized: true, owner: '' }).owner()).toEqual({});
  });

  it('still binds fields when no owner is configured', () => {
    expect(createPreviewBindings({ authorized: true }).bind<Homepage>('heroTitle')).toEqual({
      'data-payload-field': 'heroTitle',
    });
  });
});

describe('createPreviewBindings — request scoping', () => {
  it('freezes the verdict, so a later mutation of the options cannot widen it', () => {
    const options = { authorized: false };
    const preview = createPreviewBindings(options);
    options.authorized = true;

    expect(preview.bind<Homepage>('heroTitle')).toEqual({});
    expect(preview.authorized).toBe(false);
  });

  it('keeps two requests independent', () => {
    const anonymous = createPreviewBindings({ authorized: false, owner: 'global:homepage' });
    const editor = createPreviewBindings({ authorized: true, owner: 'global:homepage' });

    expect(anonymous.bind<Homepage>('heroTitle')).toEqual({});
    expect(editor.bind<Homepage>('heroTitle')).toEqual({ 'data-payload-field': 'heroTitle' });
  });
});
