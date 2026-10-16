/**
 * Navigation replay keeps the last accepted editor document independent from
 * consumer callbacks. These tests pin its revision and document context.
 */

import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { buildBuiltinRenderers } from '@field-types/index';
import { LivePreviewRuntime } from '@core/lifecycle';
import { ISLAND_EVENT, type IslandUpdateDetail } from '@core/islands';
import type {
  FragmentContext,
  FragmentReport,
  FragmentStrategy,
  RouteStrategy,
} from '@core/strategies';
import { IO, TRUSTED, fireMessage, flushMicrotasks, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — navigation replay context', () => {
  it('forces an identical snapshot back onto a retained binding with a new revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const sendReady = vi.fn();
    const revisions: number[] = [];
    const emitter = new EventEmitter();
    emitter.on('afterUpdate', ({ revision }) => {
      if (revision !== undefined) revisions.push(revision);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      sendReady,
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      skipUnchanged: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(element.textContent).toBe('unsaved');

    element.textContent = 'published on the next route';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(element.textContent).toBe('unsaved');
    expect(sendReady).toHaveBeenCalledTimes(2);
    expect(revisions).toEqual([1, 2]);

    fireMessage({ type: 'payload-live-preview', data: { title: 'newer remote edit' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(element.textContent).toBe('newer remote edit');
    expect(runtime.updateCount).toBe(2);
    expect(revisions).toEqual([1, 2, 3]);
    runtime.destroy();
  });

  it('retains locale, schema, and owner scope without repeating relationship ingress', async () => {
    document.body.innerHTML =
      '<section data-payload-owner="global:homepage">' +
      '<p data-payload-field="title">published</p>' +
      '</section>';
    const updates: unknown[] = [];
    const relationshipUpdate = vi.fn();
    const emitter = new EventEmitter();
    emitter.on('beforeUpdate', ({ data }) => {
      updates.push(data);
    });
    emitter.on('relationshipUpdate', relationshipUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      scopeBindingsByOwner: true,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      locale: 'de',
      fieldSchemaJSON: [{ name: 'title', type: 'text' }],
      externallyUpdatedRelationship: {
        entitySlug: 'categories',
        id: 'related',
        updatedAt: '2026-09-24T00:00:00.000Z',
      },
      data: { title: 'ungespeichert' },
    });
    await vi.advanceTimersByTimeAsync(50);

    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    element.textContent = 'published on the next route';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(element.textContent).toBe('ungespeichert');
    expect(runtime.updateCount).toBe(1);
    expect(updates).toHaveLength(2);
    expect(relationshipUpdate).toHaveBeenCalledOnce();
    expect(updates[1]).toMatchObject({
      fields: { title: 'ungespeichert' },
      globalSlug: 'homepage',
      locale: 'de',
      schema: [{ name: 'title', type: 'text' }],
    });
    runtime.destroy();
  });

  it('sends a best-effort ready without fabricating an update when no snapshot exists', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
    const sendReady = vi.fn();
    const afterUpdate = vi.fn();
    const emitter = new EventEmitter();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      sendReady,
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(sendReady).toHaveBeenCalledTimes(2);
    expect(afterUpdate).not.toHaveBeenCalled();
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('published');
    runtime.destroy();
  });

  it('replays accepted work lost from the scheduler across a bfcache suspension', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      visibilityGateThreshold: 0,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved before bfcache' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(element.textContent).toBe('published');
    expect(runtime.inspect().scheduler.deferred).toBeGreaterThan(0);

    runtime.suspend();
    runtime.start();
    await vi.advanceTimersByTimeAsync(50);
    IO.latest?.setVisible(element, true);
    await flushMicrotasks();

    expect(element.textContent).toBe('unsaved before bfcache');
    expect(runtime.updateCount).toBe(1);
    runtime.destroy();
  });

  it('applies the retained navigation document to a binding that streams in later', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      skipUnchanged: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved streamed title' } });
    await vi.advanceTimersByTimeAsync(50);

    document.body.innerHTML = '<p data-testid="loading">Loading destination</p>';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    document.body.innerHTML = '<h1 data-payload-field="title">published streamed route</h1>';
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    expect(document.querySelector('h1')?.textContent).toBe('unsaved streamed title');
    expect(runtime.updateCount).toBe(1);
    runtime.destroy();
  });

  it('applies retained data when a streamed binding gains its matching owner', async () => {
    document.body.innerHTML = `
      <section data-payload-owner="global:homepage">
        <h1 data-payload-field="title">published first route</h1>
      </section>
    `;
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      scopeBindingsByOwner: true,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      data: { title: 'unsaved owned title' },
    });
    await vi.advanceTimersByTimeAsync(50);

    document.body.innerHTML = `
      <section id="streamed">
        <h1 data-payload-field="title">published streamed route</h1>
      </section>
    `;
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    document.querySelector('#streamed')?.setAttribute('data-payload-owner', 'global:homepage');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    expect(document.querySelector('h1')?.textContent).toBe('unsaved owned title');
    runtime.destroy();
  });

  it('lets a reentrant newer snapshot claim the navigation baseline', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const snapshot = { title: 'unsaved title', conditional: 'unsaved conditional' };
    let dispatchNewer = false;
    const dependencies: Record<string, readonly string[]> = {};
    Object.defineProperty(dependencies, 'trigger', {
      enumerable: true,
      get: () => {
        if (dispatchNewer) {
          dispatchNewer = false;
          fireMessage({ type: 'payload-live-preview', data: snapshot });
        }
        return [];
      },
    });
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('failed');
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      dependencies,
      strategies: { route: { plan: () => false, refresh } },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: snapshot });
    await vi.advanceTimersByTimeAsync(50);

    document.body.innerHTML = '<h1 data-payload-field="title">published next route</h1>';
    dispatchNewer = true;
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(refresh).toHaveBeenCalledOnce();
    expect(document.querySelector('h1')?.textContent).toBe('unsaved title');
    expect(runtime.updateCount).toBe(2);
    runtime.destroy();
  });

  it('runs the route strategy for a route-owned binding that streams in later', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('failed');
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      strategies: { route: { plan: () => false, refresh } },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved route title' } });
    await vi.advanceTimersByTimeAsync(50);

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    document.body.innerHTML =
      '<h1 data-payload-field="title" data-payload-strategy="route">published streamed route</h1>';
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    expect(refresh).toHaveBeenCalledOnce();
    expect(document.querySelector('h1')?.textContent).toBe('unsaved route title');
    runtime.destroy();
  });

  it('does not carry a cancelled route retry debt into the committed route', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
    const refresh = vi.fn<RouteStrategy['refresh']>((context) => {
      context.retryAfter?.(10_000);
      return Promise.resolve('refused');
    });
    const route: RouteStrategy = {
      plan: (root, changed) =>
        changed.has('routeOnly') && root.querySelector('[data-payload-field="routeOnly"]') === null,
      refresh,
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      strategies: { route },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved' } });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'unsaved', routeOnly: 'route draft' },
    });
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledOnce();

    document.body.innerHTML =
      '<p data-payload-field="title">published next</p>' +
      '<p data-payload-field="routeOnly">published route field</p>';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(refresh).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-payload-field="routeOnly"]')?.textContent).toBe(
      'route draft',
    );
    runtime.destroy();
  });

  it('hands a retained binding to the route strategy when hydration changes its owner', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('failed');
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      strategies: { route: { plan: () => false, refresh } },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved hydrated title' } });
    await vi.advanceTimersByTimeAsync(50);

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    const heading = document.querySelector('h1');
    if (heading === null) throw new Error('binding missing');
    heading.textContent = 'published hydration commit';
    heading.setAttribute('data-payload-strategy', 'route');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    expect(refresh).toHaveBeenCalledOnce();
    expect(heading.textContent).toBe('unsaved hydrated title');
    runtime.destroy();
  });

  it('runs the fragment strategy for a fragment binding that streams in later', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const render = vi.fn<FragmentStrategy['render']>((context, boundaries) => {
      for (const boundary of boundaries) context.patch(boundary);
      return Promise.resolve({ rendered: 0, failed: boundaries.length, superseded: 0 });
    });
    const fragment: FragmentStrategy = {
      plan: (root, changed) =>
        changed.has('title') ? [...root.querySelectorAll('[data-payload-fragment]')] : [],
      render,
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      strategies: { fragment },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved fragment title' } });
    await vi.advanceTimersByTimeAsync(50);

    document.body.innerHTML = '<p data-testid="loading">Loading</p>';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    document.body.innerHTML = `
      <section data-payload-fragment="hero">
        <h1 data-payload-field="title" data-payload-strategy="fragment">published fragment</h1>
      </section>
    `;
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    expect(render).toHaveBeenCalledOnce();
    expect(document.querySelector('h1')?.textContent).toBe('unsaved fragment title');
    runtime.destroy();
  });

  it('keeps every streamed fragment run in flight until that run settles', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const runs = new Map<
      string,
      {
        context: FragmentContext;
        boundary: Element;
        resolve: (report: FragmentReport) => void;
      }
    >();
    const fragment: FragmentStrategy = {
      plan: (root, changed) =>
        changed.has('title') ? [...root.querySelectorAll('[data-payload-fragment]')] : [],
      render: (context, boundaries) =>
        new Promise((resolve) => {
          const boundary = boundaries[0];
          const id = boundary?.getAttribute('data-payload-fragment');
          if (boundary === undefined || id === null || id === undefined) {
            throw new Error('fragment missing');
          }
          runs.set(id, { context, boundary, resolve });
        }),
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      strategies: { fragment },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved fragment title' } });
    await vi.advanceTimersByTimeAsync(50);

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section data-payload-fragment="first"><h1 data-payload-field="title">one</h1></section>',
    );
    await vi.advanceTimersByTimeAsync(150);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section data-payload-fragment="second"><h1 data-payload-field="title">two</h1></section>',
    );
    await vi.advanceTimersByTimeAsync(150);

    expect([...runs.keys()]).toEqual(['first', 'second']);
    expect(runtime.inspect().fragments.inFlight).toBe(2);
    const second = runs.get('second');
    if (second === undefined) throw new Error('second fragment run missing');
    second.context.patch(second.boundary);
    second.context.failed(second.boundary, 'second', undefined, 'LP0801', 'fixture failure');
    second.resolve({ rendered: 0, failed: 1, superseded: 0 });
    await flushMicrotasks();

    expect(runtime.inspect().fragments.inFlight).toBe(1);
    const first = runs.get('first');
    if (first === undefined) throw new Error('first fragment run missing');
    fireMessage({ type: 'payload-live-preview', data: { title: 'newer remote edit' } });
    expect(first.context.signal.aborted).toBe(true);
    runtime.destroy();
  });

  it('escalates an unfaithful binding that streams into the navigated document', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('failed');
    const runtime = new LivePreviewRuntime({
      renderers: buildBuiltinRenderers(),
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      strategies: { route: { plan: () => false, refresh } },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved structured title' } });
    await vi.advanceTimersByTimeAsync(50);

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<h2 data-payload-field="title"><span>published structured title</span></h2>',
    );
    await vi.advanceTimersByTimeAsync(150);

    expect(refresh).toHaveBeenCalledOnce();
    expect(runtime.inspect().fidelity).toMatchObject({ unfaithful: 1, escalated: 1 });
    runtime.destroy();
  });

  it('sends the retained snapshot to an island that streams in later', async () => {
    document.body.innerHTML = '<p data-testid="loading">Loading</p>';
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved island title' } });
    await vi.advanceTimersByTimeAsync(50);

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1);
    const island = document.createElement('astro-island');
    const received: IslandUpdateDetail[] = [];
    island.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    document.body.append(island);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ fields: { title: 'unsaved island title' } });
    runtime.destroy();
  });

  it('replays the retained snapshot when a streamed Astro island finishes hydration', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved island title' } });
    await vi.advanceTimersByTimeAsync(50);

    document.body.innerHTML = '<p data-testid="loading">Loading</p>';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    const island = document.createElement('astro-island');
    island.setAttribute('ssr', '');
    island.innerHTML = '<h1 data-payload-field="title">published island</h1>';
    document.body.append(island);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    const received: IslandUpdateDetail[] = [];
    island.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    island.removeAttribute('ssr');
    island.dispatchEvent(new CustomEvent('astro:hydrate'));
    await flushMicrotasks();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ fields: { title: 'unsaved island title' } });
    runtime.destroy();
  });
});
