/**
 * How deep the fields of a fragment request may nest. Ordinary Payload content
 * is deeper than it looks: a bulleted list in a column's rich text inside a
 * layout block is 13 levels, and a list nested five levels 29. The ceiling
 * exists to bound recursion on a body anyone can post, not to refuse content.
 */
import { describe, expect, it } from 'vitest';
import { createFragmentEndpointHandler } from '@adapters/shared/fragment-endpoint';
import { parseFragmentRequest } from '@/types/fragment-protocol';

const text = { type: 'text', text: 'Punkt', format: 0, mode: 'normal' };
const listItem = (children: readonly unknown[]) => ({ type: 'listitem', children });
const list = (items: readonly unknown[]) => ({ type: 'list', listType: 'bullet', children: items });
const richText = (children: readonly unknown[]) => ({ root: { type: 'root', children } });

/** `layout[0].columns[0].richText.root.children[0].children[0].children[0].mode`: 13 levels. */
const listInColumn = {
  title: 'Technik',
  layout: [
    {
      blockType: 'content',
      columns: [{ size: 'full', richText: richText([list([listItem([text])])]) }],
    },
  ],
};

function nestedList(levels: number): unknown {
  let current = list([listItem([text])]);
  for (let level = 1; level < levels; level += 1) current = list([listItem([text, current])]);
  return current;
}

/** A list nested five levels in the same column: 29 levels. */
const nestedListInColumn = {
  layout: [{ blockType: 'content', columns: [{ richText: richText([nestedList(5)]) }] }],
};

/** `{ a: [[…[0]…]] }` with the innermost value at exactly `levels`. */
function nestedTo(levels: number): Record<string, unknown> {
  let value: unknown = 0;
  for (let level = 1; level < levels; level += 1) value = [value];
  return { a: value };
}

function body(fields: Record<string, unknown>) {
  return { fragment: 'content', route: '/technik', search: '', revision: 1, fields };
}

describe('fragment request depth', () => {
  it('accepts a bulleted list in a column block, 13 levels deep', () => {
    expect(parseFragmentRequest(body(listInColumn))?.fields).toEqual(listInColumn);
  });

  it('accepts a list nested five levels in a column block, 29 levels deep', () => {
    expect(parseFragmentRequest(body(nestedListInColumn))).not.toBeNull();
  });

  it('keeps a ceiling: 64 levels pass, 65 are refused', () => {
    expect(parseFragmentRequest(body(nestedTo(64)))).not.toBeNull();
    expect(parseFragmentRequest(body(nestedTo(65)))).toBeNull();
  });

  it('refuses a body nested far past the ceiling without walking all of it', () => {
    expect(parseFragmentRequest(body(nestedTo(20_000)))).toBeNull();
  });

  it('looks at every sibling: a deep branch after a shallow one, or after one at the ceiling', () => {
    expect(parseFragmentRequest(body({ first: 0, second: nestedTo(64) }))).toBeNull();
    expect(parseFragmentRequest(body({ first: nestedTo(63), second: nestedTo(64) }))).toBeNull();
    expect(
      parseFragmentRequest(body({ first: nestedTo(63), second: nestedTo(63) })),
    ).not.toBeNull();
  });

  it('stops at the first branch past the ceiling and walks no sibling after it', () => {
    let walked = 0;
    const later = new Proxy(
      { title: 'x' },
      {
        ownKeys(target) {
          walked += 1;
          return Reflect.ownKeys(target);
        },
      },
    );

    expect(parseFragmentRequest(body({ first: nestedTo(65), later }))).toBeNull();
    expect(walked).toBe(0);
  });

  it('renders such a page through the endpoint instead of answering 400', async () => {
    const handler = createFragmentEndpointHandler(
      {
        registry: {
          content: {
            component: 'Content',
            props: ({ fields }) => ({ layout: fields['layout'] }),
          },
        },
        authorize: { type: 'verifier', verify: () => ({ subject: 'editor' }) },
      },
      { render: () => Promise.resolve('<section>Technik</section>'), rendererName: 'test' },
    );
    const response = await handler(
      new Request('https://site.example.com/payload/fragment', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://site.example.com' },
        body: JSON.stringify(body(listInColumn)),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ html: '<section>Technik</section>' });
  });
});
