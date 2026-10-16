/**
 * The actual fixture proxy seam owns only its request's listeners and socket.
 * Native TLS tests prove cancellation on the wire; these pin cleanup and the
 * normal response path so keep-alive is not sacrificed to make aborts pass.
 */
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const moduleUrl = pathToFileURL(resolve('scripts/fixture-proxy-lifetime.mjs')).href;
const { bindProxyLifetime } = (await import(moduleUrl)) as {
  bindProxyLifetime: (
    incoming: EventEmitter,
    outgoing: EventEmitter,
    upstream: EventEmitter,
  ) => void;
};

function connection() {
  const incoming = Object.assign(new EventEmitter(), {
    destroyed: false,
    complete: false,
    unpipe: vi.fn(),
  });
  const outgoing = Object.assign(new EventEmitter(), { destroyed: false, writableFinished: false });
  const upstream = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  const foreign = vi.fn();
  outgoing.on('close', foreign);
  return { incoming, outgoing, upstream, foreign };
}

function expectCleanup({ incoming, outgoing, upstream, foreign }: ReturnType<typeof connection>) {
  expect(incoming.listenerCount('close')).toBe(0);
  expect(outgoing.listeners('close')).toEqual([foreign]);
  expect(outgoing.listenerCount('finish')).toBe(0);
  expect(upstream.listenerCount('close')).toBe(0);
}

describe('local production proxy request lifetime', () => {
  it('cancels an incomplete upload and removes every listener it installed', () => {
    const c = connection();
    bindProxyLifetime(c.incoming, c.outgoing, c.upstream);
    c.incoming.emit('close');
    expect(c.incoming.unpipe).toHaveBeenCalledExactlyOnceWith(c.upstream);
    expect(c.upstream.destroy).toHaveBeenCalledOnce();
    expectCleanup(c);
    c.outgoing.emit('close');
    expect(c.upstream.destroy).toHaveBeenCalledOnce();
    expect(c.foreign).toHaveBeenCalledOnce();
  });

  it('cancels after the upload ended when the response has not finished', () => {
    const c = connection();
    bindProxyLifetime(c.incoming, c.outgoing, c.upstream);
    c.incoming.complete = true;
    c.incoming.emit('close');
    expect(c.upstream.destroy).not.toHaveBeenCalled();
    c.outgoing.emit('close');
    expect(c.upstream.destroy).toHaveBeenCalledOnce();
    expectCleanup(c);
  });

  it('leaves a normally completed upstream socket reusable', () => {
    const c = connection();
    bindProxyLifetime(c.incoming, c.outgoing, c.upstream);
    c.outgoing.writableFinished = true;
    c.outgoing.emit('finish');
    expectCleanup(c);
    c.outgoing.emit('close');
    expect(c.upstream.destroy).not.toHaveBeenCalled();
    expect(c.incoming.unpipe).not.toHaveBeenCalled();
  });

  it('also treats close with writableFinished as normal completion', () => {
    const c = connection();
    bindProxyLifetime(c.incoming, c.outgoing, c.upstream);
    c.outgoing.writableFinished = true;
    c.outgoing.emit('close');
    expect(c.upstream.destroy).not.toHaveBeenCalled();
    expectCleanup(c);
  });

  it('releases its listeners when the upstream closes first', () => {
    const c = connection();
    bindProxyLifetime(c.incoming, c.outgoing, c.upstream);
    c.upstream.emit('close');
    expect(c.upstream.destroy).not.toHaveBeenCalled();
    expectCleanup(c);
  });

  it('handles an already aborted upload', () => {
    const c = connection();
    c.incoming.destroyed = true;
    bindProxyLifetime(c.incoming, c.outgoing, c.upstream);
    expect(c.upstream.destroy).toHaveBeenCalledOnce();
    expectCleanup(c);
  });

  it('handles an already closed response without cancelling a completed one', () => {
    const c = connection();
    c.outgoing.destroyed = true;
    bindProxyLifetime(c.incoming, c.outgoing, c.upstream);
    expect(c.upstream.destroy).toHaveBeenCalledOnce();
    expectCleanup(c);
    const completed = connection();
    completed.outgoing.destroyed = true;
    completed.outgoing.writableFinished = true;
    bindProxyLifetime(completed.incoming, completed.outgoing, completed.upstream);
    completed.outgoing.emit('finish');
    expect(completed.upstream.destroy).not.toHaveBeenCalled();
    expectCleanup(completed);
  });

  it('does not confuse an already consumed upload with a client disconnect', () => {
    const c = connection();
    c.incoming.complete = true;
    c.incoming.destroyed = true;
    bindProxyLifetime(c.incoming, c.outgoing, c.upstream);
    expect(c.upstream.destroy).not.toHaveBeenCalled();
    c.outgoing.writableFinished = true;
    c.outgoing.emit('finish');
    expectCleanup(c);
  });

  it('never aborts another request when one editor disconnects', () => {
    const first = connection();
    const second = connection();
    bindProxyLifetime(first.incoming, first.outgoing, first.upstream);
    bindProxyLifetime(second.incoming, second.outgoing, second.upstream);
    first.outgoing.emit('close');
    expect(first.upstream.destroy).toHaveBeenCalledOnce();
    expect(second.upstream.destroy).not.toHaveBeenCalled();
    second.outgoing.writableFinished = true;
    second.outgoing.emit('finish');
    expectCleanup(first);
    expectCleanup(second);
  });
});
