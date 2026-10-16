/**
 * H05's fixture derives page context only from claims the endpoint already
 * verified. Request-body fields may select display data, never Astro locals.
 */
import type { FragmentRenderInput } from 'payload-live-preview/astro';
import type { SignedTokenStrategy } from 'payload-live-preview/server';
import { SITE, strategy } from './preview';

interface TrustedPageContext {
  readonly locale: string;
  readonly params: Readonly<Record<string, string>>;
  readonly path: string;
  readonly request: Request;
  readonly subject: string;
}

interface ProbeProps {
  readonly delayMs: number;
  readonly expectedLocale: string;
  readonly expectedRoute: string;
  readonly expectedSlug: string;
  readonly expectedSubject: string;
  readonly marker: string;
}

interface ForeignProps {
  readonly marker: string;
}

function routeParts(path: string): { locale: string; slug: string } {
  const parts = path.split('/').filter(Boolean);
  const marker = parts.lastIndexOf('h05');
  return {
    locale: marker >= 0 ? (parts[marker + 1] ?? '') : '',
    slug: marker >= 0 ? (parts[marker + 2] ?? '') : '',
  };
}

export const h05Strategy: SignedTokenStrategy = {
  ...strategy,
  locale: (request) => routeParts(new URL(request.url).pathname).locale || undefined,
};

export function trustedPageContext(input: FragmentRenderInput): TrustedPageContext {
  const path = input.authorization.scope.path;
  if (path === undefined) throw new Error('H05 fixture requires a path-bound preview token');
  const route = routeParts(path);
  const locale = input.authorization.scope.locale ?? '';
  const subject = input.authorization.subject ?? '';
  return {
    path,
    locale,
    subject,
    params: { locale: route.locale, slug: route.slug },
    request: new Request(new URL(path, SITE), {
      headers: locale === '' ? undefined : { 'accept-language': locale },
    }),
  };
}

export function probeProps(input: FragmentRenderInput): ProbeProps {
  const context = trustedPageContext(input);
  const requestedDelay = input.fields.delayMs;
  const delayMs =
    typeof requestedDelay === 'number' &&
    Number.isInteger(requestedDelay) &&
    requestedDelay >= 0 &&
    requestedDelay <= 100
      ? requestedDelay
      : 0;
  return {
    expectedLocale: context.locale,
    expectedRoute: context.path,
    expectedSlug: context.params.slug,
    expectedSubject: context.subject,
    marker: typeof input.fields.marker === 'string' ? input.fields.marker : '',
    delayMs,
  };
}

export function foreignProps(input: FragmentRenderInput): ForeignProps {
  return { marker: typeof input.fields.marker === 'string' ? input.fields.marker : '' };
}
