import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApp,
  defineComponent,
  effectScope,
  h,
  nextTick,
  onMounted,
  watch,
  type App,
} from 'vue';
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

function update(title: string, id = '1'): MessageEvent {
  return new MessageEvent('message', {
    origin: ADMIN,
    source: window.parent,
    data: { type: 'payload-live-preview', collectionSlug: 'pages', data: { id, title } },
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

function mount(fetchFn: typeof fetch, initialData: Page = INITIAL): Mounted {
  const Preview = defineComponent({
    setup() {
      const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
        serverURL: SERVER,
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        initialData,
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

  it('reports which message its data came from, and the refs agree after the render', async () => {
    let fail = false;
    const painted: [number, string][] = [];
    const Painted = defineComponent({
      setup() {
        const { data, revision } = useLivePreviewDocument<Page>({
          serverURL: SERVER,
          allowedOrigins: [ADMIN],
          eventSourcePolicy: 'any',
          initialData: INITIAL,
          fetchFn: (...args: Parameters<typeof fetch>) =>
            fail
              ? Promise.reject(new TypeError('Failed to fetch'))
              : respondWith({ id: '1', title: 'Merged' })(...args),
        });
        // After mount and, with flush: 'post', after each patch: what they read is painted.
        const note = (value: number): void => {
          painted.push([value, host.querySelector('h1')?.textContent ?? '']);
        };
        onMounted(() => {
          note(revision.value);
        });
        watch(revision, note, { flush: 'post' });
        return () => h('h1', data.value.title);
      },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(Painted);
    app.mount(host);
    mounted = { app, host, text: () => host.textContent };
    window.dispatchEvent(update('Typed'));
    await settle();
    fail = true;
    window.dispatchEvent(update('Typed again'));
    await settle();
    expect(painted).toEqual([
      [0, 'From the server'],
      [1, 'Merged'],
    ]);
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

  it('does not update its refs when an in-flight response settles after scope disposal', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    let title = (): string => 'scope did not run';
    const scope = effectScope();
    scope.run(() => {
      const { data } = useLivePreviewDocument<Page>({
        serverURL: SERVER,
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        initialData: INITIAL,
        fetchFn,
      });
      title = () => data.value.title;
    });

    window.dispatchEvent(update('Typed'));
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    scope.stop();

    resolveRequest?.(
      new Response(JSON.stringify({ id: '1', title: 'Late result' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await settle();

    expect(title()).toBe('From the server');
  });

  it('starts a new document session after unmount and ignores the old late response', async () => {
    const pageA: Page = { id: '1', title: 'Page A' };
    const pageB: Page = { id: '2', title: 'Page B' };
    let resolveOld: ((response: Response) => void) | undefined;
    let oldSignal: AbortSignal | null | undefined;
    const oldFetch = vi.fn((_url: string, init?: RequestInit) => {
      oldSignal = init?.signal;
      return new Promise<Response>((resolve) => {
        resolveOld = resolve;
      });
    });
    const newFetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '2', title: 'Page B live' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const first = mount(oldFetch as unknown as typeof fetch, pageA);

    window.dispatchEvent(update('Page A edit'));
    await Promise.resolve();
    expect(oldFetch).toHaveBeenCalledTimes(1);
    first.app.unmount();
    first.host.remove();
    expect(oldSignal?.aborted).toBe(true);

    mounted = mount(newFetch, pageB);
    resolveOld?.(
      new Response(JSON.stringify({ id: '1', title: 'Late Page A' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await settle();
    expect(mounted.host.querySelector('h1')?.textContent).toBe('Page B');

    window.dispatchEvent(update('Page B edit', '2'));
    await settle();
    expect(newFetch).toHaveBeenCalledTimes(1);
    expect(mounted.host.querySelector('h1')?.textContent).toBe('Page B live');
  });
});
