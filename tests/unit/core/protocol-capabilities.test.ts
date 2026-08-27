import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import {
  CAPABILITY_DECLARATIONS,
  PROTOCOL_CAPABILITIES,
  negotiateProtocol,
  observeCapabilities,
} from '@core/protocol-version';
import { detectProtocolProfile } from '@core/protocol-profile';
import { CAPABILITY_DOCUMENTATION } from '@core/protocol-capability-docs';
import type { FieldRenderer } from '@core/types';

/**
 * Capabilities are real (roadmap 1.8.0): each names a behaviour, declares a
 * fallback, and becomes active by version or by observation. The stock
 * admin announces no version, so what it can do is read off its messages.
 */

class IO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
const TRUSTED = 'https://admin.example.com';
let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;
const renders: string[] = [];
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    renders.push(String(value));
    target.element.textContent = String(value);
  },
};
function post(
  data: Record<string, unknown> | undefined,
  extra: Record<string, unknown> = {},
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', ...(data === undefined ? {} : { data }), ...extra },
      origin: TRUSTED,
    }),
  );
}
function afterUpdate(): Promise<void> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => {
      resolve();
    });
  });
}
function start(options: { skipUnchanged?: boolean } = {}): LivePreviewRuntime {
  runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
    ...options,
  });
  runtime.start();
  return runtime;
}
beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  renders.length = 0;
  document.body.innerHTML = '<p data-payload-field="title">old</p>';
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('declarations', () => {
  it('every capability declares when it activates, what it gates and its fallback', () => {
    for (const capability of PROTOCOL_CAPABILITIES) {
      expect(CAPABILITY_DECLARATIONS[capability].since).toBeGreaterThanOrEqual(1);
      const documentation = CAPABILITY_DOCUMENTATION[capability];
      expect(documentation.fallback.length).toBeGreaterThan(10);
      expect(documentation.gates.length).toBeGreaterThan(10);
    }
    expect(Object.keys(CAPABILITY_DOCUMENTATION).sort()).toEqual([...PROTOCOL_CAPABILITIES].sort());
  });
  it('reads capabilities off a message shape', () => {
    expect(observeCapabilities({})).toEqual([]);
    expect(observeCapabilities({ fieldSchemaJSON: [], locale: 'de' })).toEqual([
      'schema-json',
      'locale',
    ]);
    expect(observeCapabilities({ previewToken: 't' })).toEqual(['preview-token']);
    expect(observeCapabilities({ externallyUpdatedRelationship: { entitySlug: 'x' } })).toEqual([
      'relationship-events',
    ]);
    expect(observeCapabilities({ externallyUpdatedRelationship: null })).toEqual([]);
  });
  it('negotiation unions version-granted and observed capabilities and reports the observed ones', () => {
    const none = negotiateProtocol(undefined);
    expect([...none.capabilities]).toEqual(['basic']);
    expect(none.observed.size).toBe(0);
    const seen = negotiateProtocol(undefined, ['locale', 'document-events']);
    expect(seen.capabilities.has('locale')).toBe(true);
    expect(seen.capabilities.has('document-events')).toBe(true);
    expect(seen.capabilities.has('schema-json')).toBe(false);
    expect([...seen.observed].sort()).toEqual(['document-events', 'locale']);
    const versioned = negotiateProtocol(4, ['locale']);
    expect(versioned.capabilities.size).toBe(PROTOCOL_CAPABILITIES.length);
  });
  it('derives the profile from what was observed', () => {
    expect(detectProtocolProfile(new Set()).name).toBe('unknown');
    expect(detectProtocolProfile(new Set(['schema-json'])).name).toBe('payload-2');
    expect(detectProtocolProfile(new Set(['schema-json'])).populatesRelationships).toBe('admin');
    expect(detectProtocolProfile(new Set(['document-events'])).name).toBe('payload-3');
    expect(detectProtocolProfile(new Set(['relationship-events'])).populatesRelationships).toBe(
      'server',
    );
  });
});

describe('runtime', () => {
  it('starts with basic only and grows as the admin shows what it sends', async () => {
    const rt = start();
    expect(rt.inspect().protocol).toMatchObject({
      capabilities: ['basic'],
      observed: [],
      profile: 'unknown',
    });
    const done = afterUpdate();
    post({ title: 'a' }, { locale: 'de' });
    await done;
    expect(rt.inspect().protocol.observed).toEqual(['locale']);
    expect(rt.inspect().protocol.capabilities).toContain('locale');
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'payload-document-event' }, origin: TRUSTED }),
    );
    expect(rt.inspect().protocol.observed).toEqual(['document-events', 'locale']);
    expect(rt.inspect().protocol.profile).toBe('payload-3');
  });
  it('a schema on the wire marks the peer as Payload 2.x', async () => {
    const rt = start();
    const done = afterUpdate();
    post({ title: 'a' }, { fieldSchemaJSON: [{ name: 'title', type: 'text' }] });
    await done;
    expect(rt.inspect().protocol.profile).toBe('payload-2');
    expect(rt.inspect().protocol.capabilities).toContain('schema-json');
  });
  it('an announced version keeps its grants when a capability is observed later', async () => {
    const rt = start();
    post(undefined, { ready: true, protocolVersion: 2 });
    expect(rt.inspect().protocol.negotiated).toBe(2);
    expect(rt.inspect().protocol.capabilities).toContain('schema-json');
    const done = afterUpdate();
    post({ title: 'a' }, { locale: 'de' });
    await done;
    expect(rt.inspect().protocol.negotiated).toBe(2);
    expect(rt.inspect().protocol.capabilities).toEqual(
      expect.arrayContaining(['basic', 'schema-json', 'locale']),
    );
  });
  it('a relationship edit fires relationshipUpdate and re-renders even under skipUnchanged', async () => {
    const rt = start({ skipUnchanged: true });
    const events: unknown[] = [];
    emitter.on('relationshipUpdate', (event) => {
      events.push(event.detail);
    });
    let done = afterUpdate();
    post({ title: 'same' });
    await done;
    expect(renders).toEqual(['same']);
    // Nothing changed: every field is skipped, so no flush and no afterUpdate.
    post({ title: 'same' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(renders).toEqual(['same']);
    expect(rt.inspect().revisions.skippedUnchanged).toBe(1);
    done = afterUpdate();
    post({ title: 'same' }, { externallyUpdatedRelationship: { entitySlug: 'authors', id: 7 } });
    await done;
    expect(renders).toEqual(['same', 'same']);
    expect(events).toEqual([{ entitySlug: 'authors', id: 7 }]);
    expect(rt.inspect().protocol.observed).toContain('relationship-events');
  });
});
