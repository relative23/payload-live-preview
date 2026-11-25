import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createDocumentSession } from '@adapters/shared/document-session';
import { ProtocolTracker } from '@/core/protocol-tracker';
import { PAYLOAD_2_REFUSED } from '@/core/protocol-version';

/**
 * Only Payload 2 sends `fieldSchemaJSON`, and this package no longer serves Payload 2 (ADR 0007,
 * row 25). Nothing of such an admin is applied; the runtime says why once, in every build, and a
 * hook reports it as its state.
 */

const ADMIN = 'https://admin.example.com';
const noop = (): void => undefined;

describe('the Payload 2 refusal from the runtime', () => {
  it('is reported once when a message shows the schema, and names the release line for Payload 2', () => {
    const warn = vi.fn();
    const tracker = new ProtocolTracker();
    tracker.observe(['locale'], noop, warn);
    expect(warn).not.toHaveBeenCalled();
    expect(tracker.unsupported).toBe(false);
    tracker.observe(['locale', 'schema-json'], noop, warn);
    tracker.observe(['schema-json'], noop, warn);
    expect(warn.mock.calls).toEqual([[PAYLOAD_2_REFUSED]]);
    expect(tracker.unsupported).toBe(true);
    expect(PAYLOAD_2_REFUSED).toBe(
      '[live-preview] LP0504: this admin sends fieldSchemaJSON, which only Payload 2 does. ' +
        'This release supports Payload 3 and 4, so its updates are not applied. Use ' +
        'payload-live-preview 2.x with Payload 2; a sender of your own leaves the field out.',
    );
  });

  it('is reported in a production build too: a refusal is not a development hint', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const warn = vi.fn();
      const tracker = new ProtocolTracker();
      tracker.observe(['schema-json'], noop, warn);
      expect(warn.mock.calls).toEqual([[PAYLOAD_2_REFUSED]]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('the Payload 2 refusal from a hook', () => {
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

  function open(document?: { collection: string; id: string }) {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ title: 'Merged' })));
    const session = createDocumentSession<{ title: string }>(
      { title: 'One' },
      {
        serverURL: 'https://cms.example.com',
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        fetchFn,
        ...(document === undefined ? {} : { document }),
      },
    );
    stops.push(session.subscribe(noop));
    return { session, fetchFn };
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

  const reports = (): unknown[] => warn.mock.calls.filter((call) => call[0] === PAYLOAD_2_REFUSED);

  it('takes nothing of an admin that sends the schema, and says so as its state', async () => {
    const { session, fetchFn } = open();
    post({ collectionSlug: 'pages', fieldSchemaJSON: [] });
    // Payload 2 sends the schema once; the updates after it are the same admin's.
    post({ collectionSlug: 'pages' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.error?.message).toBe(PAYLOAD_2_REFUSED);
    expect(snapshot.data).toEqual({ title: 'One' });
    expect(snapshot.revision).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(reports()).toHaveLength(1);
  });

  it('reports the refusal once, and an answer still in flight does not publish over it', async () => {
    let answer!: (response: Response) => void;
    const { session, fetchFn } = open();
    fetchFn.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const publications = vi.fn();
    stops.push(session.subscribe(publications));
    post({ collectionSlug: 'pages', data: { id: '1', title: 'Typed' } });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    expect(session.getSnapshot().isLoading).toBe(true);

    post({ collectionSlug: 'pages', fieldSchemaJSON: [] });
    const refused = session.getSnapshot();
    expect(refused).toMatchObject({ status: 'unavailable', isLoading: false, revision: 0 });
    const published = publications.mock.calls.length;

    post({ collectionSlug: 'pages' });
    answer(Response.json({ id: '1', title: 'Merged' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.getSnapshot()).toBe(refused);
    expect(publications).toHaveBeenCalledTimes(published);
  });

  it('merges an update without the schema as before', async () => {
    const { session, fetchFn } = open();
    post({ collectionSlug: 'pages', data: { id: '1', title: 'Typed' } });
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('live'));
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(reports()).toHaveLength(0);
  });

  it('refuses also where the session would have left the message alone for naming no document', () => {
    const { session } = open({ collection: 'pages', id: '1' });
    post({ fieldSchemaJSON: [] });
    expect(session.getSnapshot().status).toBe('unavailable');
    expect(reports()).toHaveLength(1);
  });

  it('keeps the console quiet in production and still reports the state', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { session } = open();
    post({ fieldSchemaJSON: [] });
    expect(reports()).toHaveLength(0);
    expect(session.getSnapshot().error?.message).toBe(PAYLOAD_2_REFUSED);
  });
});
