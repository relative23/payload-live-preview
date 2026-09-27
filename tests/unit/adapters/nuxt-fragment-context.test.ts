/**
 * H18 characterizes the Nuxt fragment binding with the real Vue peer.
 * The default is intentionally a fresh standalone Vue app; a custom renderer
 * is the existing request-local seam for providers derived on the server.
 */
import { describe, expect, it } from 'vitest';
import {
  createSSRApp,
  defineComponent,
  getCurrentInstance,
  h,
  inject,
  type Component,
  type InjectionKey,
} from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createFragmentEndpoint, type VueComponentLike } from '@adapters/nuxt/fragments';
import { issuePreviewToken } from '@security/preview-authorization';

const SITE = 'https://site.example.test';
const SECRET = 'h18-nuxt-context-secret-at-least-32-bytes-long';
const PROVIDER: InjectionKey<string> = Symbol('h18-provider');

interface FragmentBody {
  readonly html: string;
  readonly metadata: { readonly renderer: string };
}

async function fragmentRequest(
  marker: string,
  subject: string,
  revision: number,
): Promise<Request> {
  const previewToken = await issuePreviewToken(
    { audience: SITE, path: '/preview', subject },
    { secret: SECRET },
  );
  return new Request(`${SITE}/payload/fragment`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: SITE,
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify({
      fragment: 'probe',
      route: '/preview',
      search: `?previewToken=${previewToken}`,
      revision,
      fields: { marker },
    }),
  });
}

function options(component: VueComponentLike) {
  return {
    authorize: {
      type: 'signed-token' as const,
      secret: SECRET,
      audience: SITE,
    },
    registry: {
      probe: {
        component,
        props: ({ fields }: { readonly fields: Readonly<Record<string, unknown>> }) => {
          const marker = fields['marker'];
          return { marker: typeof marker === 'string' ? marker : '' };
        },
      },
    },
  };
}

async function body(response: Response): Promise<FragmentBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as FragmentBody;
}

describe('Nuxt fragment context', () => {
  it('creates an isolated standalone Vue app for each concurrent render', async () => {
    const apps = new Map<string, unknown>();
    const Probe = defineComponent({
      props: { marker: { type: String, required: true } },
      setup(props) {
        const instance = getCurrentInstance();
        if (instance === null) throw new Error('Vue instance unavailable');
        apps.set(props.marker, instance.appContext.app);
        const provided = inject(PROVIDER, 'provider-unavailable');
        return () => h('p', { 'data-provider': provided }, props.marker);
      },
    });
    const endpoint = createFragmentEndpoint(options(Probe));
    const [aliceRequest, bobRequest] = await Promise.all([
      fragmentRequest('alice-marker', 'alice', 1),
      fragmentRequest('bob-marker', 'bob', 2),
    ]);

    const [alice, bob] = await Promise.all([
      endpoint(aliceRequest).then(body),
      endpoint(bobRequest).then(body),
    ]);

    expect(alice.html).toContain('alice-marker');
    expect(bob.html).toContain('bob-marker');
    expect(alice.html).toContain('data-provider="provider-unavailable"');
    expect(bob.html).toContain('data-provider="provider-unavailable"');
    expect(apps.get('alice-marker')).not.toBe(apps.get('bob-marker'));
    expect(alice.metadata.renderer).toBe('vue-server-renderer');
  });

  it('can attach a verified request-local provider through the existing custom renderer seam', async () => {
    const Probe = defineComponent({
      props: { marker: { type: String, required: true } },
      setup(props) {
        const provided = inject(PROVIDER, 'provider-unavailable');
        return () => h('p', { 'data-provider': provided }, `${props.marker}:${provided}`);
      },
    });
    const endpoint = createFragmentEndpoint({
      ...options(Probe),
      render: async (component, props, input) => {
        const app = createSSRApp(component as Component, props);
        app.provide(PROVIDER, `${input.authorization.subject}:${String(input.revision)}`);
        return renderToString(app);
      },
    });
    const [aliceRequest, bobRequest] = await Promise.all([
      fragmentRequest('first', 'alice', 7),
      fragmentRequest('second', 'bob', 8),
    ]);

    const [alice, bob] = await Promise.all([
      endpoint(aliceRequest).then(body),
      endpoint(bobRequest).then(body),
    ]);

    expect(alice.html).toContain('first:alice:7');
    expect(alice.html).toContain('data-provider="alice:7"');
    expect(bob.html).toContain('second:bob:8');
    expect(bob.html).toContain('data-provider="bob:8"');
    expect(alice.metadata.renderer).toBe('custom');
    expect(bob.metadata.renderer).toBe('custom');
  });
});
