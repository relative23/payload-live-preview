import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLivePreview, LivePreviewClient } from '@client/index';
import {
  IO,
  TRUSTED,
  deferred,
  fireMessage,
  fireUpdate,
  preparePreviewPage,
  restorePreviewPage,
  pipelineConfig,
} from './client-harness';

beforeEach(preparePreviewPage);
afterEach(restorePreviewPage);

describe('LivePreviewClient — lifecycle', () => {
  it('goes quiet while suspended and delivers again after resuming', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient(pipelineConfig());

    try {
      await fireUpdate({ title: 'before' });
      expect(document.querySelector('h1')?.textContent).toBe('before');

      expect(client.suspend()).toBe(true);
      await fireUpdate({ title: 'while suspended' });
      // The ingress is released, so the message reaches nothing at all.
      expect(document.querySelector('h1')?.textContent).toBe('before');

      expect(client.resume()).toBe(true);
      await fireUpdate({ title: 'after' });
      expect(document.querySelector('h1')?.textContent).toBe('after');
    } finally {
      await client.destroy();
    }
  });

  it('re-broadcasts ready to the locked origin alone after a suspend/resume cycle', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const other = 'https://staging-admin.example.com';
    // Localhost matching off: in dev mode `enumerate()` would add 24 dev ports.
    const client = new LivePreviewClient(
      pipelineConfig({ allowedOrigins: [TRUSTED, other], disableLocalhostMatching: true }),
    );

    try {
      expect(client.inspect().origins.trusted).toEqual([TRUSTED, other]);

      await fireUpdate({ title: 'locks the origin' });
      expect(client.inspect().origins.locked).toBe(TRUSTED);

      // A bfcache restore re-runs no script: the handshake targets are read
      // again here, so the pre-lock candidate must not come back.
      expect(client.suspend()).toBe(true);
      expect(client.resume()).toBe(true);

      expect(client.inspect().origins.trusted).toEqual([TRUSTED]);
    } finally {
      await client.destroy();
    }
  });

  it('keeps plugins across a suspension, unlike destroy', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient(pipelineConfig());

    try {
      await client.use({
        name: 'shouty',
        init: (ctx) => {
          ctx.registerTransform('title', (value) => `!${String(value)}`);
        },
      });
      expect(client.suspend()).toBe(true);
      expect(client.resume()).toBe(true);
      await fireUpdate({ title: 'kept' });

      // A rebuild would have lost the transform; a suspension must not.
      expect(document.querySelector('h1')?.textContent).toBe('!kept');
      expect(client.plugins).toContain('shouty');
    } finally {
      await client.destroy();
    }
  });

  it('supersedes pre-navigation async work through the public navigation refresh', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published</h1>';
    const oldUpdate = deferred<undefined>();
    let beforeUpdate = 0;
    const client = new LivePreviewClient(pipelineConfig());
    client.events.on('beforeUpdate', async () => {
      beforeUpdate += 1;
      if (beforeUpdate === 1) await oldUpdate.promise;
    });

    try {
      fireUpdate({ title: 'old delayed edit' }).catch(() => undefined);
      await Promise.resolve();
      document.querySelector('h1')!.textContent = 'published next route';
      client.refreshAfterNavigation();
      fireUpdate({ title: 'new remote edit' }).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('h1')?.textContent).toBe('new remote edit');

      oldUpdate.resolve(undefined);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('h1')?.textContent).toBe('new remote edit');
    } finally {
      oldUpdate.resolve(undefined);
      await client.destroy();
    }
  });

  it('replays the last accepted document into the markup of the next route on refreshAfterNavigation()', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published</h1>';
    const client = new LivePreviewClient(pipelineConfig());

    try {
      await fireUpdate({ title: 'typed' });
      // The router swapped the page for the server's render of the saved document.
      document.body.innerHTML = '<h1 data-payload-field="title">published</h1>';

      client.refreshAfterNavigation();
      await vi.advanceTimersByTimeAsync(50);

      expect(document.querySelector('h1')?.textContent).toBe('typed');
    } finally {
      await client.destroy();
    }
  });

  it('refuses to suspend or resume a client that never started or was destroyed', async () => {
    const client = new LivePreviewClient(pipelineConfig({ autoStart: false }));
    expect(client.suspend()).toBe(false);
    expect(client.resume()).toBe(false);

    expect(client.start()).toBe(true);
    expect(client.suspend()).toBe(true);
    expect(client.suspend()).toBe(false);

    await client.destroy();
    expect(client.resume()).toBe(false);
    expect(client.suspend()).toBe(false);
  });

  it('can retry a failed runtime startup without reconstructing the client', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    class FailingIntersectionObserver extends IO {
      constructor(callback: IntersectionObserverCallback) {
        super(callback);
        throw new Error('client observer unavailable');
      }
    }
    globalThis.IntersectionObserver = FailingIntersectionObserver;
    const client = new LivePreviewClient(pipelineConfig({ autoStart: false }));

    try {
      expect(() => client.start()).toThrow('client observer unavailable');
      globalThis.IntersectionObserver = originalIntersectionObserver;
      expect(client.start()).toBe(true);

      await fireUpdate({ title: 'after retry' });
      expect(document.querySelector('h1')?.textContent).toBe('after retry');
      expect(client.updateCount).toBe(1);
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      await client.destroy();
    }
  });

  it('can retry after a deferred DOM-ready startup fails behind the client start flag', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    class FailingIntersectionObserver extends IO {
      constructor(callback: IntersectionObserverCallback) {
        super(callback);
        throw new Error('deferred client observer unavailable');
      }
    }
    globalThis.IntersectionObserver = FailingIntersectionObserver;
    const client = new LivePreviewClient(pipelineConfig({ autoStart: false }));
    const startupErrors: string[] = [];
    client.events.on('error', ({ error, context }) => {
      if (context === 'startup') startupErrors.push(error.message);
    });

    try {
      expect(client.start()).toBe(true);
      readyState.mockReturnValue('interactive');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await Promise.resolve();

      expect(startupErrors).toEqual(['deferred client observer unavailable']);

      globalThis.IntersectionObserver = originalIntersectionObserver;
      // The runtime rolled its failed deferred transaction back; start() must
      // retry it rather than report a dead start.
      expect(client.start()).toBe(true);
      await fireUpdate({ title: 'after deferred retry' });

      expect(document.querySelector('h1')?.textContent).toBe('after deferred retry');
      expect(client.updateCount).toBe(1);
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      readyState.mockRestore();
      await client.destroy();
    }
  });

  it('destroy is idempotent and clears state', async () => {
    const client = new LivePreviewClient(pipelineConfig());
    await client.destroy();
    await client.destroy();
    expect(client.destroyed).toBe(true);
  });

  it('shares one in-flight destroy promise across concurrent callers', async () => {
    const releaseDestroy = deferred<undefined>();
    const client = new LivePreviewClient(pipelineConfig());
    await client.use({
      name: 'slow-destroy',
      init: () => undefined,
      destroy: () => releaseDestroy.promise,
    });

    const firstDestroy = client.destroy();
    const secondDestroy = client.destroy();
    expect(secondDestroy).toBe(firstDestroy);
    let firstSettled = false;
    let secondSettled = false;
    const first = firstDestroy.then(() => {
      firstSettled = true;
    });
    const second = secondDestroy.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    releaseDestroy.resolve(undefined);
    await Promise.all([first, second]);
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
  });

  it('binds markup added since the last scan as soon as refreshCache() is called', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient(pipelineConfig());

    try {
      await fireUpdate({ title: 'first', subtitle: 'first' });
      document.body.insertAdjacentHTML('beforeend', '<p data-payload-field="subtitle">old</p>');

      // The mutation observer would find the paragraph too, 100 ms later; a
      // caller that replaced markup itself does not have to wait for it.
      client.refreshCache();
      await fireUpdate({ title: 'first', subtitle: 'typed' });

      expect(document.querySelector('p')?.textContent).toBe('typed');
    } finally {
      await client.destroy();
    }
  });

  it('releases the origin lock when the heartbeat runs out, so another allowed admin can connect', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const other = 'https://staging-admin.example.com';
    const client = new LivePreviewClient(
      pipelineConfig({
        allowedOrigins: [TRUSTED, other],
        disableLocalhostMatching: true,
        heartbeatMs: 1_000,
      }),
    );
    const fromOther = (title: string): void => {
      fireMessage({ type: 'payload-live-preview', data: { title } }, other);
    };

    try {
      await fireUpdate({ title: 'from the first admin' });
      expect(client.inspect().origins.locked).toBe(TRUSTED);

      fromOther('refused while locked');
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('h1')?.textContent).toBe('from the first admin');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(client.status).toBe('disconnected');
      expect(client.inspect().origins.locked).toBeUndefined();

      fromOther('from the other admin');
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('h1')?.textContent).toBe('from the other admin');
      expect(client.inspect().origins.locked).toBe(other);
    } finally {
      await client.destroy();
    }
  });
});

describe('initLivePreview', () => {
  it('returns a started client inside a preview frame', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = initLivePreview(pipelineConfig());

    try {
      expect(client).toBeInstanceOf(LivePreviewClient);
      await fireUpdate({ title: 'typed' });
      expect(document.querySelector('h1')?.textContent).toBe('typed');
    } finally {
      await client?.destroy();
    }
  });

  it('returns null on a top-level visit and leaves the page alone', async () => {
    Object.defineProperty(window, 'top', { value: window, configurable: true });
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';

    expect(initLivePreview()).toBeNull();

    await fireUpdate({ title: 'typed' });
    expect(document.querySelector('h1')?.textContent).toBe('old');
  });
});
