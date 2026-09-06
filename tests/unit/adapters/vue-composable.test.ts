import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, effectScope, h, nextTick, type App } from 'vue';
import { useLivePreviewDocument } from '@adapters/vue/index';

/**
 * The composable: that it subscribes for the life of its scope, re-renders the
 * component with the merged document, and reports a failed merge instead of
 * looking like a document that did not change. What the merge itself does is
 * asserted once, in `document-session.test.ts` — this entry and the React one
 * share that session.
 */

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';

interface Page extends Record<string, unknown> {
  id: string;
  title: string;
}

const INITIAL: Page = { id: '1', title: 'From the server' };

function update(title: string): MessageEvent {
  return new MessageEvent('message', {
    origin: ADMIN,
    source: window.parent,
    data: { type: 'payload-live-preview', collectionSlug: 'pages', data: { id: '1', title } },
  });
}

function respondWith(body: unknown, init: ResponseInit = {}): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    );
}

interface Mounted {
  readonly app: App;
  readonly host: HTMLElement;
  text: () => string;
}

function mount(fetchFn: typeof fetch): Mounted {
  const Preview = defineComponent({
    setup() {
      const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
        serverURL: SERVER,
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        initialData: INITIAL,
        fetchFn,
      });
      return () =>
        h('article', [
          h('h1', data.value.title),
          h('p', { class: 'status' }, status.value),
          h('p', { class: 'loading' }, String(isLoading.value)),
          h('p', { class: 'error' }, error.value?.message ?? ''),
        ]);
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(Preview);
  app.mount(host);
  return {
    app,
    host,
    text: () => host.textContent,
  };
}

/** One macrotask plus Vue's render queue: the merge is a promise chain. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.app.unmount();
  mounted?.host.remove();
  mounted = undefined;
});

describe('useLivePreviewDocument — Vue', () => {
  it('renders the initial document, then the merged one', async () => {
    mounted = mount(respondWith({ id: '1', title: 'Merged' }));
    expect(mounted.text()).toContain('From the server');
    expect(mounted.host.querySelector('.status')?.textContent).toBe('idle');
    expect(mounted.host.querySelector('.loading')?.textContent).toBe('true');

    window.dispatchEvent(update('Typed in the admin'));
    await settle();

    expect(mounted.host.querySelector('h1')?.textContent).toBe('Merged');
    expect(mounted.host.querySelector('.status')?.textContent).toBe('live');
    expect(mounted.host.querySelector('.loading')?.textContent).toBe('false');
    expect(mounted.host.querySelector('.error')?.textContent).toBe('');
  });

  it('keeps the document and reports the failure when a merge does not land', async () => {
    mounted = mount(() => Promise.reject(new TypeError('Failed to fetch')));

    window.dispatchEvent(update('Typed'));
    await settle();

    expect(mounted.host.querySelector('h1')?.textContent).toBe('From the server');
    expect(mounted.host.querySelector('.status')?.textContent).toBe('unavailable');
    expect(mounted.host.querySelector('.error')?.textContent).toContain('Failed to fetch');
  });

  it('stops listening when the component unmounts', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '1', title: 'Merged' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const view = mount(fetchFn);
    view.app.unmount();
    view.host.remove();

    window.dispatchEvent(update('Typed'));
    await settle();

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('releases the subscription with its effect scope, not only with a component', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '1', title: 'Merged' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const scope = effectScope();
    scope.run(() => {
      useLivePreviewDocument<Page>({
        serverURL: SERVER,
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        initialData: INITIAL,
        fetchFn,
      });
    });
    scope.stop();

    window.dispatchEvent(update('Typed'));
    await settle();

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses to run without a scope, because nothing could release it', () => {
    expect(() =>
      useLivePreviewDocument<Page>({
        serverURL: SERVER,
        allowedOrigins: [ADMIN],
        initialData: INITIAL,
      }),
    ).toThrow(/needs an effect scope/u);
  });
});
