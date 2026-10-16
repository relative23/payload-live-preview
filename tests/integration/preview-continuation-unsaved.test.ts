/**
 * Bridges the bounded reference envelope into the actual DocumentSession.
 * This local adapter is test-only, not a public hook transport; the separate
 * real-Payload probe establishes population and ACL behavior on the database.
 */
import { describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '@adapters/shared/document-session';
import { createReferenceContinuation } from '../fixtures/preview-continuation';
import { createReferenceUnsavedHandler } from '../fixtures/preview-continuation-unsaved';
import { continuationHarness, CONTINUATION_SITE } from '../fixtures/preview-continuation-harness';

describe('unsaved continuation document consumer', () => {
  it.each([false, true])(
    'renders two unsaved selections, refuses stale responses, keeps last good state and recovers (related drafts: %s)',
    async (relatedDrafts) => {
      const h = continuationHarness();
      const reference = createReferenceContinuation({
        ...h.options,
        binding: () => ({
          ...h.target,
          document: { kind: 'collection', slug: 'articles', id: 'post-a' },
        }),
      });
      const opened = await reference.exchange(
        h.request(`/page?locale=de&previewToken=${await h.token()}`),
      );
      expect(opened.status).toBe(303);
      const cookie = `${h.loginCookie}; ${opened.headers.get('set-cookie')!.split(';')[0]!}`;
      const initial = {
        id: 'post-a',
        title: 'Saved',
        related: [{ id: 1, title: 'Saved relation' }],
        files: [{ id: 1, title: 'Saved file' }],
      };
      let failure = false;
      let deniedRelation = false;
      let wrongRevision = false;
      const upstream = vi.fn<typeof fetch>().mockImplementation((url, init) => {
        const selected = typeof url === 'string' ? /\/(records|media)\/(\d+)\?/.exec(url) : null;
        if (deniedRelation && selected?.[1] === 'records') {
          return Promise.resolve(Response.json({ errors: ['Denied'] }, { status: 404 }));
        }
        if (failure && (!relatedDrafts || selected !== null)) {
          return Promise.resolve(
            Response.json({ errors: ['private failure'] }, { status: relatedDrafts ? 500 : 403 }),
          );
        }
        if (selected !== null) {
          return Promise.resolve(
            Response.json({
              id: Number(selected[2]),
              title: `${selected[1] === 'records' ? 'Relation' : 'File'} ${selected[2]}`,
              _status: 'draft',
            }),
          );
        }
        if (init?.method !== 'POST') return Promise.resolve(Response.json(initial));
        expect(typeof init.body).toBe('string');
        const { data } = JSON.parse(init.body as string) as { data: Record<string, unknown> };
        if (relatedDrafts) return Promise.resolve(Response.json(data));
        return Promise.resolve(
          Response.json({
            ...data,
            related: (data['related'] as number[]).map((id) => ({ id, title: `Relation ${id}` })),
            files: (data['files'] as number[]).map((id) => ({ id, title: `File ${id}` })),
          }),
        );
      });
      const handle = createReferenceUnsavedHandler(reference, {
        fetch: upstream,
        ...(relatedDrafts ? { relatedDrafts: {} } : {}),
      });
      const frame = document.createElement('iframe');
      document.body.append(frame);
      const target = frame.contentWindow!;
      let releaseSlow!: () => void;
      let enteredSlow!: () => void;
      const slowEntered = new Promise<void>((yes) => {
        enteredSlow = yes;
      });
      const slow = new Promise<void>((yes) => {
        releaseSlow = yes;
      });
      let revision = 0;
      let finished = 0;
      const session = new DocumentSession(initial, {
        target,
        serverURL: CONTINUATION_SITE,
        allowedOrigins: [CONTINUATION_SITE],
        fetchFn: async (_url, init) => {
          const expected = ++revision;
          expect(typeof init?.body).toBe('string');
          const { data } = JSON.parse(init?.body as string) as { data: Record<string, unknown> };
          expect(data['id']).toBe('post-a');
          const response = await handle(
            new Request(h.request(undefined, cookie), {
              method: 'POST',
              headers: { cookie, origin: CONTINUATION_SITE, 'content-type': 'application/json' },
              body: JSON.stringify({
                version: 1,
                revision: expected,
                data: { title: data['title'], related: data['related'], files: data['files'] },
              }),
              ...(init?.signal == null ? {} : { signal: init.signal }),
            }),
          );
          // Deliberately hold a completed response and ignore its later abort.
          if (data['title'] === 'Slow') {
            enteredSlow();
            await slow;
          }
          finished++;
          if (!response.ok) {
            await response.body?.cancel();
            return new Response(null, { status: response.status });
          }
          const envelope = (await response.json()) as Record<string, unknown>;
          if (wrongRevision) envelope['revision'] = expected - 1;
          if (
            envelope['version'] !== 1 ||
            envelope['ok'] !== true ||
            envelope['revision'] !== expected
          ) {
            throw new Error('Invalid reference envelope');
          }
          return Response.json(envelope['data']);
        },
      });
      const stop = session.subscribe(() => {});
      const send = (title: string, selected: number) =>
        target.dispatchEvent(
          new MessageEvent('message', {
            origin: CONTINUATION_SITE,
            source: target.parent,
            data: {
              type: 'payload-live-preview',
              collectionSlug: 'articles',
              locale: 'de',
              data: { id: 'post-a', title, related: [selected], files: [selected] },
            },
          }),
        );
      const settled = async () => {
        await vi.waitFor(() => expect(session.getSnapshot().isLoading).toBe(false));
        return session.getSnapshot();
      };
      try {
        send('First unsaved', 2);
        expect((await settled()).data).toMatchObject({
          title: 'First unsaved',
          related: [{ title: 'Relation 2' }],
          files: [{ title: 'File 2' }],
        });
        send('Second unsaved', 3);
        const second = await settled();
        expect(second.status).toBe('live');
        expect(second.data).toMatchObject({
          title: 'Second unsaved',
          related: [{ title: 'Relation 3' }],
          files: [{ title: 'File 3' }],
        });
        if (relatedDrafts) {
          expect(second.data).toMatchObject({
            related: [{ _status: 'draft' }],
            files: [{ _status: 'draft' }],
          });
        }
        send('Slow', 4);
        await slowEntered;
        send('Newest', 5);
        const newest = await settled();
        expect(newest.data.title).toBe('Newest');
        releaseSlow();
        await vi.waitFor(() => expect(finished).toBe(4));
        expect(session.getSnapshot().data).toBe(newest.data);
        failure = true;
        send('Denied', 6);
        const failed = await settled();
        expect(failed.status).toBe('unavailable');
        expect(failed.data).toBe(newest.data);
        failure = false;
        wrongRevision = true;
        send('Mismatched revision', 7);
        expect((await settled()).data).toBe(newest.data);
        expect(session.getSnapshot().status).toBe('unavailable');
        wrongRevision = false;
        if (relatedDrafts) {
          deniedRelation = true;
          send('Revoked relation', 8);
          const revoked = await settled();
          expect(revoked.status).toBe('live');
          expect(revoked.data.related).toEqual([8]);
          expect(JSON.stringify(revoked.data.related)).not.toContain('Relation');
          deniedRelation = false;
        }
        send('Recovered', 8);
        const recovered = await settled();
        expect(recovered.status).toBe('live');
        expect(recovered.data.title).toBe('Recovered');
        expect(initial.title).toBe('Saved');
        // A related-read failure happens after the root POST, unlike a denied
        // root read in the original mode.
        expect(upstream.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
          relatedDrafts ? 8 : 6,
        );
      } finally {
        releaseSlow();
        stop();
        frame.remove();
      }
    },
  );
});
