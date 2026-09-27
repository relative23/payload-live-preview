import { describe, expect, it, vi } from 'vitest';
import type { PayloadDocumentEventDetail } from '@/types/payload-protocol';
import { EventEmitter } from '@events/emitter';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/**
 * A synthetic accessor stands in for any trust boundary that synchronously
 * accepts a newer message. The older revision may finish reading, but it may
 * not put its relationship identity back after the newer owner committed.
 */

describe('relationship identity under reentrant ingress', () => {
  it('does not let stale A make the next repeat of B look new', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published</h1>';
    const emitter = new EventEmitter();
    const relationshipUpdates: PayloadDocumentEventDetail[] = [];
    emitter.on('relationshipUpdate', (event) => {
      relationshipUpdates.push(event.detail);
    });
    const runtime = makeRuntime({ emitter });
    runtime.start();

    const newerEvent: PayloadDocumentEventDetail = {
      entitySlug: 'authors',
      id: 2,
      updatedAt: 'newer',
    };
    const newerMessage = {
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      data: { title: 'newer B' },
      externallyUpdatedRelationship: newerEvent,
    } as const;
    const staleEvent = { entitySlug: 'authors', id: 1 } as PayloadDocumentEventDetail;
    let reenter = true;
    Object.defineProperty(staleEvent, 'updatedAt', {
      configurable: true,
      enumerable: false,
      get(): string {
        if (reenter) {
          reenter = false;
          fireMessage(newerMessage);
        }
        return 'stale';
      },
    });

    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      data: { title: 'stale A' },
      externallyUpdatedRelationship: staleEvent,
    });
    fireMessage(newerMessage);
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('h1')?.textContent).toBe('newer B');
    expect(relationshipUpdates).toEqual([newerEvent]);
    runtime.destroy();
  });

  it('stops stale relationship event fan-out after a listener accepts a newer revision', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published</h1>';
    const emitter = new EventEmitter();
    const calls: string[] = [];
    emitter.on('relationshipUpdate', () => {
      calls.push('first');
      fireMessage({
        type: 'payload-live-preview',
        globalSlug: 'homepage',
        data: { title: 'newer B' },
      });
    });
    emitter.on('relationshipUpdate', () => {
      calls.push('stale second');
    });
    const runtime = makeRuntime({ emitter });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      data: { title: 'stale A' },
      externallyUpdatedRelationship: {
        entitySlug: 'authors',
        id: 1,
        updatedAt: 'stale',
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('h1')?.textContent).toBe('newer B');
    expect(calls).toEqual(['first']);
    runtime.destroy();
  });
});
