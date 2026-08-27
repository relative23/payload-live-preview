import { beforeAll, describe, expect, it } from 'vitest';
import { createPreviewBindings } from '@dsl/preview-bindings';
import { authorizePreviewRequest } from '@security/preview-authorization';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';

interface Homepage {
  heroTitle: string;
  intro: string;
}

/** Every attribute this package can put into markup starts with this prefix. */
function payloadAttributes(record: object): string[] {
  return Object.keys(record).filter((key) => key.startsWith('data-payload-'));
}

/**
 * 2.0 removed the `authorized: boolean` form (ADR 0007, entry 7): the only
 * verdict a binding accepts is a branded context from
 * `authorizePreviewRequest()`, or `null` for a public response.
 */
let ctx: AuthorizedPreviewContext;
beforeAll(async () => {
  const result = await authorizePreviewRequest(new Request('https://site.example.com/'), {
    type: 'verifier',
    verify: () => ({ subject: 'editor' }),
  });
  if (!result.authorized) throw new Error('expected authorization');
  ctx = result.context;
});

describe('createPreviewBindings — unauthorized (authorization: null)', () => {
  const preview = createPreviewBindings({ authorization: null, owner: 'global:homepage' });

  it('emits nothing for a plain field', () => {
    expect(preview.bind<Homepage>('heroTitle')).toEqual({});
  });

  it('emits nothing for a path binding', () => {
    expect(preview.bindByPath<Homepage>((d) => d.intro)).toEqual({});
  });

  it('emits no owner, which would otherwise disclose the document identity', () => {
    expect(preview.owner()).toEqual({});
    expect(
      createPreviewBindings({ authorization: null, owner: 'collection:services:73' }).owner(),
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

describe('createPreviewBindings — authorized (a real context)', () => {
  it('emits the field binding', () => {
    const preview = createPreviewBindings({ authorization: ctx, owner: 'global:homepage' });
    expect(preview.bind<Homepage>('heroTitle')).toEqual({ 'data-payload-field': 'heroTitle' });
  });

  it('emits the recorded path for a picker', () => {
    const preview = createPreviewBindings({ authorization: ctx, owner: 'global:homepage' });
    expect(preview.bindByPath<Homepage>((d) => d.intro)).toEqual({ 'data-payload-field': 'intro' });
  });

  it('omits presence attributes when they are explicitly false', () => {
    const preview = createPreviewBindings({ authorization: ctx, owner: 'global:homepage' });
    const attrs = preview.bind<Homepage>('intro', { richtext: false, html: false });
    expect(attrs).toEqual({ 'data-payload-field': 'intro' });
  });

  it('emits no owner when none was configured', () => {
    expect(createPreviewBindings({ authorization: ctx }).owner()).toEqual({});
    expect(createPreviewBindings({ authorization: ctx, owner: '' }).owner()).toEqual({});
  });

  it('emits the owner when one is configured', () => {
    expect(createPreviewBindings({ authorization: ctx, owner: 'pages:1' }).owner()).toEqual({
      'data-payload-owner': 'pages:1',
    });
  });
});

describe('createPreviewBindings — request scoping', () => {
  it('freezes the verdict, so a later mutation of the options cannot widen it', () => {
    const options: { authorization: AuthorizedPreviewContext | null; owner?: string } = {
      authorization: null,
    };
    const preview = createPreviewBindings(options);
    options.authorization = ctx;

    expect(preview.bind<Homepage>('heroTitle')).toEqual({});
    expect(preview.authorized).toBe(false);
  });

  it('keeps two requests independent', () => {
    const anonymous = createPreviewBindings({ authorization: null, owner: 'global:homepage' });
    const editor = createPreviewBindings({ authorization: ctx, owner: 'global:homepage' });

    expect(anonymous.bind<Homepage>('heroTitle')).toEqual({});
    expect(editor.bind<Homepage>('heroTitle')).toEqual({ 'data-payload-field': 'heroTitle' });
  });

  it('treats a look-alike context as a public response', () => {
    const lookAlikes: unknown[] = [
      { ...ctx },
      JSON.parse(JSON.stringify(ctx)) as unknown,
      { authorized: true },
    ];
    for (const fake of lookAlikes) {
      const bindings = createPreviewBindings({
        authorization: fake as AuthorizedPreviewContext,
      });
      expect(bindings.authorized, JSON.stringify(fake)).toBe(false);
      expect(bindings.bind('title')).toEqual({});
    }
  });
});
