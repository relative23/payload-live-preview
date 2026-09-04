import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

describe('Lexical auto-detection without data-payload-richtext', () => {
  it('renders a Lexical value bound to a plain element as rich text', async () => {
    document.body.innerHTML = '<div data-payload-field="body">old</div>';
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: {
        body: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'Hallo Welt' }],
              },
            ],
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    const div = document.querySelector('[data-payload-field="body"]');
    expect(div?.innerHTML).toContain('<p');
    expect(div?.textContent).toContain('Hallo Welt');
    expect(div?.textContent).not.toContain('[object Object]');
    runtime.destroy();
  });
  it('does not override an explicit data-payload-type', async () => {
    document.body.innerHTML = '<div data-payload-field="body" data-payload-type="text">old</div>';
    const rendered: unknown[] = [];
    const runtime = makeRuntime({
      renderers: {
        text: {
          name: 'text',
          render: (target, value) => {
            rendered.push(value);
            target.element.textContent = 'text-renderer';
          },
        },
      },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      data: { body: { root: { children: [] } } },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(rendered).toHaveLength(1);
    runtime.destroy();
  });
});
