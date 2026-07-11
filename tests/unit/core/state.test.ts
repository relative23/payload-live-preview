import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState, HeartbeatTimer } from '@core/state';

describe('HeartbeatTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onTimeout after timeoutMs without kicks', () => {
    const onTimeout = vi.fn();
    const heartbeat = new HeartbeatTimer({ timeoutMs: 100, onTimeout });
    heartbeat.kick();
    vi.advanceTimersByTime(99);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(heartbeat.pending).toBe(false);
  });

  it('kick resets the timeout window', () => {
    const onTimeout = vi.fn();
    const heartbeat = new HeartbeatTimer({ timeoutMs: 100, onTimeout });
    heartbeat.kick();
    vi.advanceTimersByTime(50);
    heartbeat.kick();
    vi.advanceTimersByTime(50);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('stop cancels pending timeout', () => {
    const onTimeout = vi.fn();
    const heartbeat = new HeartbeatTimer({ timeoutMs: 100, onTimeout });
    heartbeat.kick();
    heartbeat.stop();
    vi.advanceTimersByTime(500);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(heartbeat.pending).toBe(false);
  });

  it('stop is idempotent', () => {
    const heartbeat = new HeartbeatTimer({ timeoutMs: 100, onTimeout: () => {} });
    expect(() => {
      heartbeat.stop();
      heartbeat.stop();
    }).not.toThrow();
  });

  it('uses default timeoutMs when not provided', () => {
    const onTimeout = vi.fn();
    const heartbeat = new HeartbeatTimer({ onTimeout });
    heartbeat.kick();
    vi.advanceTimersByTime(30_000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('tracks lastKickAt', () => {
    const heartbeat = new HeartbeatTimer({ onTimeout: () => {} });
    const before = Date.now();
    heartbeat.kick();
    expect(heartbeat.lastKickAt).toBeGreaterThanOrEqual(before);
  });
});

describe('ConnectionState', () => {
  it('transitions through every status', () => {
    const onChange = vi.fn();
    const state = new ConnectionState(onChange);
    expect(state.status).toBe('disconnected');
    expect(state.markConnecting()).toBe(true);
    expect(state.status).toBe('connecting');
    expect(state.markConnected()).toBe(true);
    expect(state.status).toBe('connected');
    expect(state.markDisconnected()).toBe(true);
    expect(state.status).toBe('disconnected');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('idempotent transitions return false and do not call onChange', () => {
    const onChange = vi.fn();
    const state = new ConnectionState(onChange);
    expect(state.markDisconnected()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    state.markConnected();
    onChange.mockClear();
    expect(state.markConnected()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('passes previous status to onChange', () => {
    const onChange = vi.fn();
    const state = new ConnectionState(onChange);
    state.markConnecting();
    expect(onChange).toHaveBeenLastCalledWith('connecting', 'disconnected');
    state.markConnected();
    expect(onChange).toHaveBeenLastCalledWith('connected', 'connecting');
  });
});
