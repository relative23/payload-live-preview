/**
 * The shared fragment endpoint admits a request only from the bytes it really
 * consumes, independent of transport chunking and a declared length. Generated
 * multibyte titles make a UTF-16 character count an insufficient substitute.
 */
import { describe, expect } from 'vitest';
import { fc, it } from '@fast-check/vitest';
import { createFragmentEndpointHandler } from '@adapters/shared/fragment-endpoint';
import { propertyParameters } from './fast-check';

const SITE = 'https://site.example.com';
const encoder = new TextEncoder();
const textPart = fc
  .array(fc.constantFrom('a', 'Z', '0', ' ', '-', 'é', '漢', '€'), { maxLength: 12 })
  .map((characters) => characters.join(''));
const multibyteCharacter = fc.constantFrom('é', '€', '漢', 'न', '😀', '𐍈');
const title = fc
  .tuple(textPart, multibyteCharacter, textPart)
  .map(([prefix, character, suffix]) => `${prefix}${character}${suffix}`);
const chunkWidths = fc.array(fc.integer({ min: 1, max: 17 }), {
  minLength: 1,
  maxLength: 10,
});

function validJson(generatedTitle: string): string {
  return JSON.stringify({
    fragment: 'hero',
    route: '/page',
    search: '',
    revision: 1,
    fields: { title: generatedTitle },
  });
}

function split(bytes: Uint8Array, widths: readonly number[]): readonly Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let widthIndex = 0;
  while (offset < bytes.byteLength) {
    const width = widths[widthIndex % widths.length]!;
    chunks.push(bytes.slice(offset, offset + width));
    offset += width;
    widthIndex += 1;
  }
  return chunks;
}

function request(raw: string, widths: readonly number[], declared?: string): Request {
  const chunks = split(encoder.encode(raw), widths);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers({
    'content-type': 'application/json',
    origin: SITE,
    'sec-fetch-site': 'same-origin',
  });
  if (declared !== undefined) headers.set('content-length', declared);
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  };
  return new Request(`${SITE}/payload/fragment`, init);
}

function endpoint(bodyBytes: number) {
  return createFragmentEndpointHandler(
    {
      registry: {
        hero: {
          component: 'Hero',
          props: ({ fields }) => ({ title: fields['title'] }),
        },
      },
      authorize: { type: 'verifier', verify: () => ({ subject: 'editor' }) },
      limits: { bodyBytes },
    },
    {
      rendererName: 'property',
      render: (_component, props) => Promise.resolve(`<h1>${String(props['title'])}</h1>`),
    },
  );
}

describe('the fragment endpoint byte bound, for any multibyte title and chunking', () => {
  it.prop([title, chunkWidths], propertyParameters(0x48303350, 60))(
    'accepts the exact byte boundary and rejects one byte less despite absent or low declarations',
    async (generatedTitle, widths) => {
      const raw = validJson(generatedTitle);
      const actualBytes = encoder.encode(raw).byteLength;
      expect(actualBytes).toBeGreaterThan(raw.length);

      const accepted = await endpoint(actualBytes)(request(raw, widths));
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({
        html: `<h1>${generatedTitle}</h1>`,
        revision: 1,
      });

      for (const declared of [undefined, '1'] as const) {
        const refused = await endpoint(actualBytes - 1)(request(raw, widths, declared));
        expect(refused.status).toBe(413);
        expect(await refused.json()).toEqual({ error: 'body' });
      }
    },
  );
});
