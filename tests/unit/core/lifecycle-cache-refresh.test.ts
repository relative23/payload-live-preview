import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import type { RouteStrategy } from '@core/strategies';
import { buildBuiltinRenderers } from '@field-types/index';
import {
  IO,
  TRUSTED,
  deferred,
  fireMessage,
  flushMicrotasks,
  textRenderer,
} from './lifecycle-harness';

describe('LivePreviewRuntime — cache refresh', () => {
  it('renders an element once after repeated programmatic cache upserts', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const render = vi.fn((target: Parameters<FieldRenderer['render']>[0], value: unknown) => {
      target.element.textContent = String(value);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: { name: 'text', render } },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    runtime.cache.add(element);
    runtime.cache.add(element);
    fireMessage({ type: 'payload-live-preview', data: { title: 'updated' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(render).toHaveBeenCalledOnce();
    expect(element.textContent).toBe('updated');
    runtime.destroy();
  });
  it('rebuilds the cache when a new tracked element is added', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    const span = document.createElement('span');
    span.setAttribute('data-payload-field', 'subtitle');
    document.body.appendChild(span);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
    fireMessage({ type: 'payload-live-preview', data: { subtitle: 'fresh' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('span')?.textContent).toBe('fresh');
    runtime.destroy();
  });
  it('refreshCache rebuilds explicitly', () => {
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      disableVisibilityGate: true,
    });
    runtime.start();
    expect(runtime.cache.fieldCount).toBe(1);
    document.body.innerHTML = '<p data-payload-field="a">x</p><p data-payload-field="b">y</p>';
    runtime.refreshCache();
    expect(runtime.cache.fieldCount).toBe(2);
    runtime.destroy();
  });
  it('keeps an accepted snapshot across bfcache suspension for the next route commit', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
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
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved before bfcache' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(runtime.suspend()).toBe(true);
    expect(runtime.start()).toBe(true);
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    element.textContent = 'published after restore';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(element.textContent).toBe('unsaved before bfcache');
    runtime.destroy();
  });
  it('follows a replaced document body before replaying a navigation snapshot', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
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
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved next route' } });
    await vi.advanceTimersByTimeAsync(50);
    const replacement = document.createElement('body');
    replacement.innerHTML = '<h2 data-payload-field="title">published next route</h2>';
    document.documentElement.replaceChild(replacement, document.body);

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(document.body).toBe(replacement);
    expect(replacement.querySelector('h2')?.textContent).toBe('unsaved next route');
    runtime.destroy();
  });
  it('does not treat a local replay as heartbeat traffic and forgets it on timeout', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
    const connect = vi.fn();
    const emitter = new EventEmitter();
    emitter.on('connect', connect);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      heartbeatMs: 20,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved' } });
    await vi.advanceTimersByTimeAsync(5);
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(15);

    expect(connect).toHaveBeenCalledOnce();
    expect(runtime.status).toBe('disconnected');
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    element.textContent = 'published after timeout';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    expect(element.textContent).toBe('published after timeout');
    runtime.destroy();
  });
  it('lets a navigation replay escalate an unsaved field absent from the new route', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('failed');
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      strategies: { route: { plan: () => false, refresh } },
    });
    runtime.start();
    const snapshot = { title: 'unsaved', conditional: 'only in the draft' };
    fireMessage({ type: 'payload-live-preview', data: snapshot });
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).not.toHaveBeenCalled();

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(refresh).toHaveBeenCalledOnce();
    runtime.destroy();
  });
  it('gives auto-binding a baseline search on the navigated route', async () => {
    const unsaved = 'unsaved navigation title';
    document.body.innerHTML = '<p data-payload-field="title">published</p>';
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      autoBind: 'unique',
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: unsaved } });
    await vi.advanceTimersByTimeAsync(50);

    document.body.innerHTML = `<p>${unsaved}</p>`;
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.getAttribute('data-payload-field')).toBe('title');
    runtime.destroy();
  });
  it('supersedes delayed route work before two rapid navigation replays', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published route one</p>';
    const oldRoute = deferred<'refreshed'>();
    let oldSignal: AbortSignal | undefined;
    let refreshCall = 0;
    const sendReady = vi.fn();
    const refresh = vi.fn<RouteStrategy['refresh']>((context) => {
      refreshCall += 1;
      if (refreshCall > 1) return Promise.resolve('failed');
      oldSignal = context.signal;
      return oldRoute.promise.then((outcome) => {
        if (context.isCurrent()) document.body.textContent = 'stale old route';
        return outcome;
      });
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      sendReady,
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      strategies: { route: { plan: () => false, refresh } },
    });
    runtime.start();
    const snapshot = { title: 'unsaved', conditional: 'route-only draft' };
    fireMessage({ type: 'payload-live-preview', data: snapshot });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({
      type: 'payload-live-preview',
      data: { ...snapshot, conditional: 'changed route-only draft' },
    });
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledOnce();

    document.body.innerHTML = '<p data-payload-field="title">published route two</p>';
    runtime.navigationCommit();
    document.body.innerHTML = '<p data-payload-field="title">published route three</p>';
    runtime.navigationCommit();
    expect(oldSignal?.aborted).toBe(true);
    expect(sendReady).toHaveBeenCalledTimes(3);

    oldRoute.resolve('refreshed');
    await flushMicrotasks();
    expect(document.body.textContent).toBe('published route three');

    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('unsaved');
    runtime.destroy();
  });
  it('invalidates a pre-navigation token verdict before asking for the replay', async () => {
    document.body.innerHTML = '<p data-payload-field="title">published route one</p>';
    const oldVerdict = deferred<boolean>();
    const validateToken = vi
      .fn()
      .mockImplementationOnce(() => oldVerdict.promise)
      .mockResolvedValueOnce(true);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      validateToken,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'stale old route' },
      previewToken: 'old',
    });
    expect(validateToken).toHaveBeenCalledOnce();

    document.body.innerHTML = '<p data-payload-field="title">published route two</p>';
    runtime.navigationCommit();
    oldVerdict.resolve(true);
    await flushMicrotasks();
    expect(document.querySelector('p')?.textContent).toBe('published route two');

    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'current unsaved route' },
      previewToken: 'current',
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('current unsaved route');
    runtime.destroy();
  });
  it('keeps refreshCache inert after destroy', () => {
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const emitter = new EventEmitter();
    const cacheRefresh = vi.fn();
    emitter.on('cacheRefresh', cacheRefresh);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      disableVisibilityGate: true,
    });
    runtime.start();
    expect(cacheRefresh).toHaveBeenCalledOnce();
    runtime.destroy();
    document.body.innerHTML = '<p data-payload-field="replacement">replacement</p>';

    runtime.refreshCache();

    expect(runtime.cache.elementCount).toBe(0);
    expect(cacheRefresh).toHaveBeenCalledOnce();
  });
  it('retains an offscreen replay across refreshCache for the same field binding', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      visibilityGateThreshold: 0,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'replayed' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(element.textContent).toBe('initial');
    expect(afterUpdate).not.toHaveBeenCalled();

    runtime.refreshCache();
    expect(IO.latest?.observed.has(element)).toBe(true);
    IO.latest?.setVisible(element, true);
    await flushMicrotasks();

    expect(element.textContent).toBe('replayed');
    expect(afterUpdate).toHaveBeenCalledOnce();
    runtime.destroy();
  });
  it('retargets a retained debounced update to rebuilt cache metadata', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      debounceMs: 50,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'pending' } });
    await flushMicrotasks();
    element.setAttribute('data-payload-attribute', 'data-preview-value');
    runtime.refreshCache();
    await vi.advanceTimersByTimeAsync(100);

    expect(element.textContent).toBe('initial');
    expect(element.getAttribute('data-preview-value')).toBe('pending');
    expect(afterUpdate).toHaveBeenCalledOnce();
    runtime.destroy();
  });
  it('retargets renderer and attribute metadata after observed binding mutations', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const textRender = vi.fn((target: Parameters<FieldRenderer['render']>[0], value: unknown) => {
      target.element.textContent = `text:${String(value)}`;
    });
    const htmlRender = vi.fn((target: Parameters<FieldRenderer['render']>[0], value: unknown) => {
      target.element.textContent = `html:${String(value)}`;
    });
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: { name: 'text', render: textRender },
        html: { name: 'html', render: htmlRender },
      },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    element.setAttribute('data-payload-type', 'html');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({ type: 'payload-live-preview', data: { title: 'typed' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(textRender).not.toHaveBeenCalled();
    expect(htmlRender).toHaveBeenCalledOnce();
    expect(element.textContent).toBe('html:typed');

    element.setAttribute('data-payload-attribute', 'data-preview-value');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({ type: 'payload-live-preview', data: { title: 'attributed' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(htmlRender).toHaveBeenCalledOnce();
    expect(element.textContent).toBe('html:typed');
    expect(element.getAttribute('data-preview-value')).toBe('attributed');
    runtime.destroy();
  });
  it('retargets sibling href, src, and alt metadata after observed mutations', async () => {
    document.body.innerHTML =
      '<a data-payload-field="label" data-payload-href="firstHref">initial link</a>' +
      '<img data-payload-field="image" data-payload-src="firstSrc" data-payload-alt="firstAlt">';
    const link = document.querySelector('a');
    const image = document.querySelector('img');
    if (link === null || image === null) throw new Error('bindings missing');
    const runtime = new LivePreviewRuntime({
      renderers: buildBuiltinRenderers(),
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    link.setAttribute('data-payload-href', 'next.href');
    image.setAttribute('data-payload-src', 'next.src');
    image.setAttribute('data-payload-alt', 'next.alt');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({
      type: 'payload-live-preview',
      data: {
        label: 'updated link',
        image: {
          url: 'https://media.example.com/original.jpg',
          alt: 'media-object alt',
        },
        firstHref: 'https://stale.example.com',
        firstSrc: 'https://stale.example.com/stale.jpg',
        firstAlt: 'stale alt',
        next: {
          href: 'https://example.com/next',
          src: 'https://cdn.example.com/next.jpg',
          alt: 'next alt',
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(link.href).toBe('https://example.com/next');
    expect(image.src).toBe('https://cdn.example.com/next.jpg');
    expect(image.alt).toBe('next alt');
    runtime.destroy();
  });
  it('retargets array template and separator metadata after observed mutations', async () => {
    document.body.innerHTML =
      '<div id="template" data-payload-field="items" data-payload-array ' +
      'data-payload-array-template="<i>{{value}}</i>"></div>' +
      '<div id="separator" data-payload-field="tags" data-payload-array ' +
      'data-payload-array-separator=", "></div>';
    const template = document.querySelector('#template');
    const separator = document.querySelector('#separator');
    if (template === null || separator === null) throw new Error('bindings missing');
    const runtime = new LivePreviewRuntime({
      renderers: buildBuiltinRenderers(),
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    template.setAttribute('data-payload-array-template', '<strong>{{value}}</strong>');
    separator.setAttribute('data-payload-array-separator', ' / ');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({
      type: 'payload-live-preview',
      data: { items: ['one', 'two'], tags: ['alpha', 'beta'] },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(template.innerHTML).toBe('<strong>one</strong><strong>two</strong>');
    expect(separator.textContent).toBe('alpha / beta');
    runtime.destroy();
  });
  it('retargets marker- and input-inferred types after observed mutations', async () => {
    document.body.innerHTML =
      '<div data-payload-field="body">initial body</div>' +
      '<input data-payload-field="amount" type="text" value="initial amount">';
    const body = document.querySelector('div');
    const amount = document.querySelector('input');
    if (body === null || amount === null) throw new Error('bindings missing');
    const textRender = vi.fn();
    const richTextRender = vi.fn();
    const numberRender = vi.fn();
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: { name: 'text', render: textRender },
        richText: { name: 'richText', render: richTextRender },
        number: { name: 'number', render: numberRender },
      },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    body.setAttribute('data-payload-richtext', '');
    amount.setAttribute('type', 'number');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({
      type: 'payload-live-preview',
      data: { body: 'updated body', amount: 42 },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(textRender).not.toHaveBeenCalled();
    expect(richTextRender).toHaveBeenCalledOnce();
    expect(numberRender).toHaveBeenCalledOnce();
    runtime.destroy();
  });
  it('uses and retargets an element-local locale after an observed mutation', async () => {
    document.body.innerHTML =
      '<span data-payload-field="amount" data-payload-locale="de-DE">initial</span>';
    const element = document.querySelector('span');
    if (element === null) throw new Error('binding missing');
    const locales: (string | undefined)[] = [];
    const numberRenderer: FieldRenderer = {
      name: 'number',
      render(target, value, context) {
        locales.push(context.locale);
        target.element.textContent = String(value);
      },
    };
    element.setAttribute('data-payload-type', 'number');
    const runtime = new LivePreviewRuntime({
      renderers: { number: numberRenderer },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', locale: 'en-US', data: { amount: 1 } });
    await vi.advanceTimersByTimeAsync(50);
    element.setAttribute('data-payload-locale', 'fr-FR');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({ type: 'payload-live-preview', locale: 'en-US', data: { amount: 2 } });
    await vi.advanceTimersByTimeAsync(50);

    expect(locales).toEqual(['de-DE', 'fr-FR']);
    runtime.destroy();
  });
});
