/**
 * LP-2: a Lexical block the registry cannot render used to replace the markup
 * the server had already rendered for it with an empty `<div>` — one keystroke
 * in any field and the image was gone from the preview. The claim under test is
 * that the server's subtree survives the write.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { __resetBlockRegistryForTests } from '@lexical/blocks/registry';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/** What Payload sends for a post whose body is a paragraph, a media block and a paragraph. */
function documentWith(intro: string): unknown {
  return {
    title: 'Title',
    content: {
      root: {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: intro }] },
          { type: 'block', fields: { blockType: 'mediaBlock', media: { id: 7 } } },
          { type: 'paragraph', children: [{ type: 'text', text: 'outro' }] },
        ],
      },
    },
  };
}

/** The richer version the project's own server renderer produced for that document. */
const SERVER_MARKUP =
  '<p>intro</p>' +
  '<figure class="mx-auto max-w-[72rem] my-10">' +
  '<img src="https://cdn.example.com/a.jpg" alt="a" width="800" height="600">' +
  '</figure>' +
  '<p>outro</p>';

describe('a Lexical block without a renderer', () => {
  it("keeps the server's markup instead of replacing it with an empty div", async () => {
    __resetBlockRegistryForTests();
    document.body.innerHTML = `<div data-payload-field="content">${SERVER_MARKUP}</div>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: documentWith('edited') });
    await vi.advanceTimersByTimeAsync(50);

    const content = document.querySelector('[data-payload-field="content"]');
    const image = content?.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/a.jpg');
    expect(content?.querySelector('figure')?.getAttribute('class')).toBe(
      'mx-auto max-w-[72rem] my-10',
    );
    // The edit still landed: keeping a subtree is not skipping the write.
    expect(content?.querySelectorAll('p')[0]?.textContent).toBe('edited');
    expect(warn.mock.calls.map(String).join(' ')).toContain('LP0410');
    warn.mockRestore();
    runtime.destroy();
  });

  it('keeps it across the next write too, so a second edit does not lose it', async () => {
    __resetBlockRegistryForTests();
    document.body.innerHTML = `<div data-payload-field="content">${SERVER_MARKUP}</div>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: documentWith('one') });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({ type: 'payload-live-preview', data: documentWith('two') });
    await vi.advanceTimersByTimeAsync(50);

    const content = document.querySelector('[data-payload-field="content"]');
    expect(content?.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/a.jpg',
    );
    expect(content?.querySelectorAll('p')[0]?.textContent).toBe('two');
    warn.mockRestore();
    runtime.destroy();
  });
});
