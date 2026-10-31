import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DocumentSession } from '@adapters/shared/document-session';
import { ProtocolTracker } from '@/core/protocol-tracker';
import { PAYLOAD_2_HINT } from '@/core/protocol-version';

/**
 * Only Payload 2 sends `fieldSchemaJSON`, and 3.0 ends Payload 2 support (ADR 0007, row 25). The
 * hint is the one place a project on it hears that while it runs, once and only in development.
 */

const ADMIN = 'https://admin.example.com';
const noop = (): void => undefined;

describe('the Payload 2 hint from the runtime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('warns once when a message shows the schema, and names the release that ends support', () => {
    const warn = vi.fn();
    const tracker = new ProtocolTracker();
    tracker.observe(['locale'], noop, warn);
    expect(warn).not.toHaveBeenCalled();
    tracker.observe(['locale', 'schema-json'], noop, warn);
    tracker.observe(['schema-json'], noop, warn);
    expect(warn.mock.calls).toEqual([[PAYLOAD_2_HINT]]);
    expect(PAYLOAD_2_HINT).toBe(
      '[payload-live-preview] This admin sends fieldSchemaJSON, which only Payload 2 does. ' +
        'Every 2.x release of this package supports Payload 2; 3.0 supports Payload 3 and 4.',
    );
  });

  it('still records the capability, and stays silent, in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.fn();
    const tracker = new ProtocolTracker();
    tracker.observe(['schema-json'], noop, warn);
    expect(warn).not.toHaveBeenCalled();
    expect(tracker.observed.has('schema-json')).toBe(true);
  });
});

describe('the Payload 2 hint from a hook', () => {
  let warn: MockInstance<typeof console.warn>;
  const stops: (() => void)[] = [];

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(noop);
  });
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function open(document?: { collection: string; id: string }): void {
    const session = new DocumentSession<{ title: string }>(
      { title: 'One' },
      {
        serverURL: 'https://cms.example.com',
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        fetchFn: vi.fn(() => Promise.resolve(Response.json({ title: 'Merged' }))),
        ...(document === undefined ? {} : { document }),
      },
    );
    stops.push(session.subscribe(noop));
  }

  function post(message: Record<string, unknown>): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ADMIN,
        source: window.parent,
        data: { type: 'payload-live-preview', data: { title: 'Typed' }, ...message },
      }),
    );
  }

  const hints = (): unknown[] => warn.mock.calls.filter((call) => call[0] === PAYLOAD_2_HINT);

  it('warns once per session when a message carries the schema, and not for one without it', () => {
    open();
    post({ collectionSlug: 'pages' });
    expect(hints()).toHaveLength(0);
    post({ fieldSchemaJSON: [] });
    post({ fieldSchemaJSON: [] });
    expect(hints()).toHaveLength(1);
  });

  it('warns also when the session leaves the message alone for naming no document', () => {
    open({ collection: 'pages', id: '1' });
    post({ fieldSchemaJSON: [] });
    expect(hints()).toHaveLength(1);
  });

  it('stays silent in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    open();
    post({ fieldSchemaJSON: [] });
    expect(hints()).toHaveLength(0);
  });
});
