/**
 * H05 exercises the source adapter through an optimized Astro 7 production
 * build. It separates props from ambient context, assets and request isolation.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { issuePreviewToken } from '../../../src/security/preview-token';

const SITE = 'http://localhost:4177';
const SECRET = 'astro-hybrid-fixture-secret-that-is-long-enough-000';

interface FragmentResult {
  readonly html: string;
  readonly metadata: { readonly renderer: string };
}

interface FragmentCase {
  readonly delayMs?: number;
  readonly endpoint: 'h05-custom-fragment' | 'h05-default-fragment';
  readonly fragment?: 'foreign' | 'probe';
  readonly locale: string;
  readonly marker: string;
  readonly path: string;
  readonly subject: string;
}

async function renderFragment(
  request: APIRequestContext,
  input: FragmentCase,
): Promise<FragmentResult> {
  const token = await issuePreviewToken(
    {
      audience: SITE,
      path: input.path,
      locale: input.locale,
      subject: input.subject,
    },
    { secret: SECRET },
  );
  const response = await request.post(`${SITE}/payload/${input.endpoint}`, {
    headers: {
      'content-type': 'application/json',
      origin: SITE,
      'sec-fetch-site': 'same-origin',
      'x-untrusted-local': 'administrator',
    },
    data: {
      fragment: input.fragment ?? 'probe',
      route: input.path,
      search: `?preview=true&previewToken=${token}`,
      revision: 1,
      locale: input.locale,
      fields: { marker: input.marker, delayMs: input.delayMs ?? 0 },
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as FragmentResult;
}

async function mount(page: Page, html: string): Promise<void> {
  await page.locator('#h05-mount').evaluate((element, markup) => {
    element.innerHTML = markup;
  }, html);
}

test.describe('H05 Astro container context and resources', () => {
  test('the default renderer supplies props but no page request, params, locals or first-use CSS', async ({
    page,
    request,
  }) => {
    await page.goto(`${SITE}/h05/de/alpha`);
    const result = await renderFragment(request, {
      endpoint: 'h05-default-fragment',
      locale: 'de',
      marker: 'default',
      path: '/h05/de/alpha',
      subject: 'editor-a',
    });
    expect(result.metadata.renderer).toBe('astro-container');
    expect(result.html).toContain('data-astro-cid-');

    await mount(page, result.html);
    const probe = page.getByTestId('h05-probe-default');
    await expect(probe).toHaveAttribute('data-expected-route', '/h05/de/alpha');
    await expect(probe).toHaveAttribute('data-expected-locale', 'de');
    await expect(probe).toHaveAttribute('data-expected-slug', 'alpha');
    await expect(probe).toHaveAttribute('data-expected-subject', 'editor-a');
    await expect(probe).toHaveAttribute('data-context-path', '/');
    await expect(probe).toHaveAttribute('data-request-path', '/');
    await expect(probe).toHaveAttribute('data-param-locale', '');
    await expect(probe).toHaveAttribute('data-param-slug', '');
    await expect(probe).toHaveAttribute('data-local-locale', '');
    await expect(probe).toHaveAttribute('data-local-subject', '');
    await expect(probe).toHaveAttribute('data-forwarded-untrusted', '');
    expect(await probe.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  });

  test('a custom renderer restores an allowlisted, path-bound context without cross-request leakage', async ({
    page,
    request,
  }) => {
    await page.goto(`${SITE}/h05/de/host`);
    const [slowA, fastB] = await Promise.all([
      renderFragment(request, {
        delayMs: 80,
        endpoint: 'h05-custom-fragment',
        locale: 'de',
        marker: 'alpha',
        path: '/preview-base/h05/de/alpha',
        subject: 'editor-a',
      }),
      renderFragment(request, {
        endpoint: 'h05-custom-fragment',
        locale: 'fr',
        marker: 'beta',
        path: '/h05/fr/beta',
        subject: 'editor-b',
      }),
    ]);
    expect(slowA.metadata.renderer).toBe('custom');
    expect(fastB.metadata.renderer).toBe('custom');

    for (const [result, expected] of [
      [
        slowA,
        {
          locale: 'de',
          marker: 'alpha',
          path: '/preview-base/h05/de/alpha',
          slug: 'alpha',
          subject: 'editor-a',
        },
      ],
      [
        fastB,
        { locale: 'fr', marker: 'beta', path: '/h05/fr/beta', slug: 'beta', subject: 'editor-b' },
      ],
    ] as const) {
      await mount(page, result.html);
      const probe = page.getByTestId(`h05-probe-${expected.marker}`);
      await expect(probe).toHaveAttribute('data-context-path', expected.path);
      await expect(probe).toHaveAttribute('data-request-path', expected.path);
      await expect(probe).toHaveAttribute('data-param-locale', expected.locale);
      await expect(probe).toHaveAttribute('data-param-slug', expected.slug);
      await expect(probe).toHaveAttribute('data-local-locale', expected.locale);
      await expect(probe).toHaveAttribute('data-local-subject', expected.subject);
      await expect(probe).toHaveAttribute('data-forwarded-untrusted', '');
      await expect(probe.locator('[data-payload-fragment="h05-empty"]')).toBeEmpty();
      await expect(probe.getByTestId('h05-nested-value')).toHaveText(expected.slug);
    }
  });

  test('an additional renderer is absent by default and can be supplied by the existing override', async ({
    request,
  }) => {
    const path = '/h05/de/renderer';
    const token = await issuePreviewToken(
      { audience: SITE, path, locale: 'de', subject: 'editor-a' },
      { secret: SECRET },
    );
    const body = {
      fragment: 'foreign',
      route: path,
      search: `?preview=true&previewToken=${token}`,
      revision: 1,
      locale: 'de',
      fields: { marker: '<renderer-safe>' },
    };
    const defaultResponse = await request.post(`${SITE}/payload/h05-default-fragment`, {
      headers: {
        'content-type': 'application/json',
        origin: SITE,
        'sec-fetch-site': 'same-origin',
      },
      data: body,
    });
    expect(defaultResponse.status()).toBe(500);
    expect(await defaultResponse.json()).toEqual({ error: 'render' });

    const custom = await renderFragment(request, {
      endpoint: 'h05-custom-fragment',
      fragment: 'foreign',
      locale: 'de',
      marker: '<renderer-safe>',
      path,
      subject: 'editor-a',
    });
    expect(custom.metadata.renderer).toBe('custom');
    expect(custom.html).toContain(
      '<strong data-testid="h05-foreign-result">&lt;renderer-safe&gt;</strong>',
    );
  });

  test('request-body locale cannot manufacture a different trusted Astro local', async ({
    request,
  }) => {
    const path = '/h05/de/locale';
    const token = await issuePreviewToken(
      { audience: SITE, path, locale: 'de', subject: 'editor-a' },
      { secret: SECRET },
    );
    const response = await request.post(`${SITE}/payload/h05-custom-fragment`, {
      headers: {
        'content-type': 'application/json',
        origin: SITE,
        'sec-fetch-site': 'same-origin',
      },
      data: {
        fragment: 'probe',
        route: path,
        search: `?preview=true&previewToken=${token}`,
        revision: 1,
        locale: 'fr',
        fields: { marker: 'forged-locale' },
      },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });
});
