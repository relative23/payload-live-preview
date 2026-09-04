import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import {
  OTHER_TRUSTED,
  TRUSTED,
  deferred,
  fireMessage,
  flushMicrotasks,
  textRenderer,
} from './lifecycle-harness';

describe('LivePreviewRuntime — disconnect and heartbeat', () => {
  it('reports a suspension as a disconnect, and only once it was connected', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const disconnect = vi.fn();
    emitter.on('disconnect', disconnect);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      sendReady: vi.fn(),
      disableVisibilityGate: true,
      enableA11y: false,
      log: vi.fn(),
    });

    runtime.start();
    // Nothing has connected yet: a suspension here has no connection to report,
    // and announcing one would tell a consumer it lost something it never had.
    expect(runtime.suspend()).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();

    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'connected' } });
    await flushMicrotasks();
    // The connection, not the DOM write: the write goes through the scheduler's
    // debounce, which has nothing to do with what this test is about.
    expect(runtime.status).toBe('connected');

    expect(runtime.suspend()).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
    // `unload` rather than `destroy`: the instance is still usable, and a
    // consumer distinguishing the two must not be told the runtime is gone.
    expect(disconnect.mock.calls[0]?.[0]).toMatchObject({ reason: 'unload' });

    // Idempotent, and a second suspension has nothing left to announce.
    expect(runtime.suspend()).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
    runtime.destroy();
  });
  it('continues disconnect and ready recovery when the timeout hook throws', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const disconnect = vi.fn();
    const sendReady = vi.fn();
    emitter.on('disconnect', disconnect);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      heartbeatMs: 25,
      disableVisibilityGate: true,
      enableA11y: false,
      log: vi.fn(),
      onHeartbeatTimeout: () => {
        throw new Error('unlock failed');
      },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'connected' } });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(25);

    expect(runtime.status).toBe('disconnected');
    expect(disconnect).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
    expect(sendReady).toHaveBeenCalledTimes(2);
    runtime.destroy();
  });
  it('discards a token validation that settles after heartbeat expiry', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const verdict = deferred<boolean>();
    const validateToken = vi.fn(() => verdict.promise);
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 25,
      disableVisibilityGate: true,
      validateToken,
    });
    runtime.start();
    // A ready handshake starts the heartbeat but intentionally bypasses token
    // validation. The following data message remains pending across expiry.
    fireMessage({ type: 'payload-live-preview', ready: true });
    fireMessage({
      type: 'payload-live-preview',
      data: { x: 'zombie' },
      previewToken: 'pending',
    });
    expect(validateToken).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(25);
    verdict.resolve(true);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('initial');
    expect(runtime.updateCount).toBe(0);
    expect(runtime.status).toBe('disconnected');
    runtime.destroy();
  });
  it('invalidates pending update work when a heartbeat lifecycle expires', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const emitter = new EventEmitter();
    const release = deferred<undefined>();
    emitter.on('beforeUpdate', async () => release.promise);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 25,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: 'zombie' } });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(25);
    release.resolve(undefined);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });
  it('invokes onHeartbeatTimeout hook on timeout', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const onHeartbeatTimeout = vi.fn();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 50,
      disableVisibilityGate: true,
      onHeartbeatTimeout,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    vi.advanceTimersByTime(100);
    expect(onHeartbeatTimeout).toHaveBeenCalled();
    runtime.destroy();
  });
  it('does not resend ready after the timeout hook destroys the runtime', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const emitter = new EventEmitter();
    const sendReady = vi.fn();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      heartbeatMs: 25,
      disableVisibilityGate: true,
      onHeartbeatTimeout: () => {
        runtime.destroy();
      },
    });
    runtime.start();
    expect(sendReady).toHaveBeenCalledOnce();
    fireMessage({ type: 'payload-live-preview', data: { x: 'connected' } });

    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(2500);

    expect(sendReady).toHaveBeenCalledOnce();
    expect(runtime.cache.elementCount).toBe(0);
  });
  it('does not resend ready after a timeout disconnect handler destroys the runtime', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const emitter = new EventEmitter();
    const sendReady = vi.fn();
    emitter.on('disconnect', ({ reason }) => {
      if (reason === 'timeout') runtime.destroy();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      heartbeatMs: 25,
      disableVisibilityGate: true,
    });
    runtime.start();
    expect(sendReady).toHaveBeenCalledOnce();
    fireMessage({ type: 'payload-live-preview', data: { x: 'connected' } });

    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(2500);

    expect(sendReady).toHaveBeenCalledOnce();
    expect(runtime.cache.elementCount).toBe(0);
  });
  it('marks disconnected and emits when heartbeat times out', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const disconnects: string[] = [];
    emitter.on('disconnect', (e) => {
      disconnects.push(e.reason);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 50,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    vi.advanceTimersByTime(100);
    expect(disconnects).toContain('timeout');
    runtime.destroy();
  });
  it('unlocks before disconnect callbacks and preserves a reentrant reconnect lock', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const emitter = new EventEmitter();
    let lockedOrigin: string | undefined;
    emitter.on('connect', ({ origin }) => {
      lockedOrigin = origin;
    });
    emitter.on('disconnect', ({ reason }) => {
      if (reason === 'timeout') {
        fireMessage({ type: 'payload-live-preview', data: { x: 'reconnected' } }, OTHER_TRUSTED);
      }
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) =>
        lockedOrigin === undefined
          ? origin === TRUSTED || origin === OTHER_TRUSTED
          : origin === lockedOrigin,
      readyTargets: [TRUSTED, OTHER_TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 100,
      disableVisibilityGate: true,
      onHeartbeatTimeout: () => {
        lockedOrigin = undefined;
      },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: 'first' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(lockedOrigin).toBe(TRUSTED);

    await vi.advanceTimersByTimeAsync(70);
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('reconnected');
    expect(lockedOrigin).toBe(OTHER_TRUSTED);

    fireMessage({ type: 'payload-live-preview', data: { x: 'must-not-apply' } }, TRUSTED);
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('reconnected');
    runtime.destroy();
  });
  it('destroy emits a "destroy" reason for in-flight connections', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const disconnects: string[] = [];
    emitter.on('disconnect', (e) => {
      disconnects.push(e.reason);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    runtime.destroy();
    expect(disconnects).toContain('destroy');
  });
});
