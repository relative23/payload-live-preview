/**
 * Schema recursion becomes network-planning input for the legacy transport.
 * Reject cycles and oversized/deep structures before they can drive requests.
 */
import { describe, expect, it } from 'vitest';
import { parseFieldSchema } from '@schema/parser';
describe('bounded legacy schema parsing', () => {
  it('rejects a cycle without exposing a recursion exception', () => {
    const fields: unknown[] = [];
    fields.push({ name: 'loop', type: 'group', fields });
    expect(parseFieldSchema(fields)).toEqual([]);
  });
  it('rejects a schema beyond the fixed traversal depth', () => {
    let fields: unknown[] = [{ name: 'author', type: 'relationship', relationTo: 'authors' }];
    for (let depth = 0; depth < 65; depth += 1) {
      fields = [{ name: 'nested', type: 'group', fields }];
    }
    expect(parseFieldSchema(fields)).toEqual([]);
  });
  it('rejects an oversized flat schema before allocating a parsed copy of every entry', () => {
    const fields = Array.from({ length: 10_001 }, (_, index) => ({
      name: `field${index}`,
      type: 'text',
    }));
    expect(parseFieldSchema(fields)).toEqual([]);
  });
  it.each(['record', 'array'])('bounds empty block definitions in a %s schema', (shape) => {
    const blocks = Array.from({ length: 10_001 }, (_, index) => ({
      slug: `block${index}`,
    }));
    const raw =
      shape === 'record' ? Object.fromEntries(blocks.map(({ slug }) => [slug, {}])) : blocks;
    expect(parseFieldSchema([{ name: 'layout', type: 'blocks', blocks: raw }])).toEqual([]);
  });
});
