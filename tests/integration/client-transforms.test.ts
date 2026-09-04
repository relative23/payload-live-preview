import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewClient } from '@client/index';
import {
  IO,
  fireMessage,
  fireUpdate,
  preparePreviewPage,
  restorePreviewPage,
  v1Config,
} from './client-harness';

beforeEach(preparePreviewPage);
afterEach(restorePreviewPage);

describe('LivePreviewClient — transforms', () => {
  it('dispatches revision-bound transformed values through renderer and attribute paths', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title">old</p>' +
      '<span data-payload-field="label" data-payload-attribute="data-label"></span>';
    const client = new LivePreviewClient(v1Config());
    try {
      await client.use({
        name: 'transform-both-paths',
        init: (ctx) => {
          ctx.registerTransform('title', (value) => `rendered:${String(value)}`);
          ctx.registerTransform('label', (value) => `attribute:${String(value)}`);
        },
      });

      await fireUpdate({ title: 'raw title', label: 'raw label' });

      expect(document.querySelector('p')?.textContent).toBe('rendered:raw title');
      expect(document.querySelector('span')?.getAttribute('data-label')).toBe(
        'attribute:raw label',
      );
    } finally {
      await client.destroy();
    }
  });

  it('passes merged values through transforms while allFields stays the merged snapshot', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title">old</p><span data-payload-field="sibling"></span>';
    const mergedFields = {
      id: 'post-1',
      title: 'merged title',
      sibling: 'merged sibling',
    };
    const mergeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mergedFields), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new LivePreviewClient(
      v1Config({ serverURL: 'https://cms.example.com', mergeFetch: mergeFetch as typeof fetch }),
    );
    let seenValue: unknown;
    let seenAllFields: Record<string, unknown> | undefined;
    try {
      await client.use({
        name: 'merged-transform-contract',
        init: (ctx) => {
          ctx.registerTransform('title', (value, context) => {
            seenValue = value;
            seenAllFields = context.allFields;
            return `${String(value)} transformed`;
          });
        },
      });

      fireMessage({
        type: 'payload-live-preview',
        collectionSlug: 'posts',
        data: { id: 'post-1', title: 'raw title', sibling: 'raw sibling' },
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(mergeFetch).toHaveBeenCalledOnce();
      expect(seenValue).toBe('merged title');
      expect(seenAllFields).toEqual(mergedFields);
      expect(seenAllFields?.['title']).toBe('merged title');
      expect(document.querySelector('p')?.textContent).toBe('merged title transformed');
    } finally {
      await client.destroy();
    }
  });

  it('does not let a transform bypass URL validation on an attribute binding', async () => {
    document.body.innerHTML =
      '<a data-payload-field="destination" data-payload-attribute="href" href="/initial">link</a>';
    const client = new LivePreviewClient(v1Config());
    try {
      await client.use({
        name: 'unsafe-url-transform',
        init: (ctx) => {
          ctx.registerTransform('destination', () => 'javascript:alert(1)');
        },
      });

      await fireUpdate({ destination: '/incoming-safe-path' });

      expect(document.querySelector('a')?.getAttribute('href')).toBe('/initial');
    } finally {
      await client.destroy();
    }
  });

  it('reports the first flush the visibility gate holds back, once', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new LivePreviewClient(
      v1Config({ disableVisibilityGate: false, visibilityGateThreshold: 0 }),
    );
    try {
      await fireUpdate({ title: 'first' });
      // Held back: the element is offscreen and the gate is on.
      expect(element.textContent).toBe('initial');
      const gateWarnings = (): string[] =>
        warn.mock.calls
          .map((call) => String(call[0]))
          .filter((message) => message.includes('visibility gate held'));
      expect(gateWarnings()).toHaveLength(1);
      expect(gateWarnings()[0]).toContain('visibilityGateThreshold');

      // A warning per flush during typing would be noise, and noise hid this cliff.
      await fireUpdate({ title: 'second' });
      expect(gateWarnings()).toHaveLength(1);

      IO.latest?.setVisible(element, true);
      await Promise.resolve();
      expect(element.textContent).toBe('second');
    } finally {
      await client.destroy();
      warn.mockRestore();
    }
  });

  it('freezes transformed values before an offscreen revision enters replay', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const client = new LivePreviewClient(
      v1Config({ disableVisibilityGate: false, visibilityGateThreshold: 0 }),
    );
    try {
      await fireUpdate({ title: 'revision value' });
      expect(element.textContent).toBe('initial');

      await client.use({
        name: 'late-transform',
        init: (ctx) => {
          ctx.registerTransform('title', (value) => `late:${String(value)}`);
        },
      });
      IO.latest?.setVisible(element, true);
      await Promise.resolve();

      expect(element.textContent).toBe('revision value');
    } finally {
      await client.destroy();
    }
  });

  it('stops obsolete transform callbacks and diagnostics after synchronous re-entry', async () => {
    document.body.innerHTML =
      '<p data-payload-field="first">initial first</p>' +
      '<p data-payload-field="second">initial second</p>';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transforms: string[] = [];
    const client = new LivePreviewClient(v1Config());
    try {
      await client.use({
        name: 'reentrant-transform',
        init: (ctx) => {
          ctx.registerTransform('first', (value) => {
            transforms.push(`first:${String(value)}`);
            if (value === 'A first') {
              fireMessage({
                type: 'payload-live-preview',
                data: { first: 'B first', second: 'B second' },
              });
            }
            return value;
          });
          ctx.registerTransform('first', (value) => {
            transforms.push(`first-tail:${String(value)}`);
            return value;
          });
          ctx.registerTransform('second', (value) => {
            transforms.push(`second:${String(value)}`);
            return value;
          });
        },
      });

      fireMessage({
        type: 'payload-live-preview',
        data: { first: 'A first', second: 'A second', orphanA: 'must not diagnose' },
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(transforms).toEqual([
        'first:A first',
        'first:B first',
        'first-tail:B first',
        'second:B second',
      ]);
      expect(warn).not.toHaveBeenCalled();
      expect(document.querySelector('[data-payload-field="first"]')?.textContent).toBe('B first');
      expect(document.querySelector('[data-payload-field="second"]')?.textContent).toBe('B second');
    } finally {
      warn.mockRestore();
      await client.destroy();
    }
  });

  it('reports throwing and thenable transforms and applies the original value', async () => {
    document.body.innerHTML =
      '<p data-payload-field="throws">old</p><p data-payload-field="async">old</p>';
    const client = new LivePreviewClient(v1Config());
    const errors: { error: Error; context: string }[] = [];
    client.events.on('error', (event) => {
      errors.push(event);
    });
    try {
      await client.use({
        name: 'invalid-transforms',
        init: (ctx) => {
          ctx.registerTransform('throws', () => {
            throw new Error('transform exploded');
          });
          ctx.registerTransform('async', () => Promise.resolve('too late'));
        },
      });

      await fireUpdate({ throws: 'safe throw fallback', async: 'safe async fallback' });

      expect(document.querySelector('[data-payload-field="throws"]')?.textContent).toBe(
        'safe throw fallback',
      );
      expect(document.querySelector('[data-payload-field="async"]')?.textContent).toBe(
        'safe async fallback',
      );
      expect(errors).toHaveLength(2);
      expect(errors.every((entry) => entry.context === 'transform')).toBe(true);
    } finally {
      await client.destroy();
    }
  });
});
