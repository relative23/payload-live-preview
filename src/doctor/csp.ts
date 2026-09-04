/**
 * `frame-ancestors` matching by the CSP3 source-expression rules. The audit
 * judges origins, so path parts of a host-source are ignored.
 */

const DEFAULT_PORT: Readonly<Record<string, string>> = {
  http: '80',
  https: '443',
  ws: '80',
  wss: '443',
};
const SCHEME_SOURCE = /^([a-z][a-z0-9+.-]*):$/u;
const HOST_SOURCE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?)(?::(\*|\d+))?(?:\/.*)?$/u;

/** The `frame-ancestors` directive of a policy, verbatim, or `undefined` when it has none. */
export function frameAncestorsOf(csp: string | undefined): string | undefined {
  if (csp === undefined) return undefined;
  for (const directive of csp.split(';')) {
    const trimmed = directive.trim();
    if (/^frame-ancestors(?:\s|$)/iu.test(trimmed)) return trimmed;
  }
  return undefined;
}

function schemeOf(url: URL): string {
  return url.protocol.slice(0, -1).toLowerCase();
}

function portOf(url: URL): string {
  return url.port === '' ? (DEFAULT_PORT[schemeOf(url)] ?? '') : url.port;
}

function schemeMatches(expression: string, actual: string): boolean {
  return (
    expression === actual ||
    (expression === 'http' && actual === 'https') ||
    (expression === 'ws' && actual === 'wss')
  );
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true;
  const wanted = pattern.replace(/\.$/u, '');
  const actual = host.replace(/\.$/u, '');
  if (wanted.startsWith('*.')) {
    return actual.endsWith(wanted.slice(1)) && actual.length > wanted.length - 1;
  }
  return wanted === actual;
}

function isSelf(admin: URL, page: URL): boolean {
  if (admin.hostname !== page.hostname) return false;
  const adminScheme = schemeOf(admin);
  const pageScheme = schemeOf(page);
  if (adminScheme !== pageScheme && !(pageScheme === 'http' && adminScheme === 'https')) {
    return false;
  }
  return portOf(admin) === portOf(page) || (admin.port === '' && page.port === '');
}

function sourceMatches(source: string, admin: URL, page: URL): boolean {
  const scheme = SCHEME_SOURCE.exec(source);
  if (scheme?.[1] !== undefined) return schemeMatches(scheme[1], schemeOf(admin));
  const host = HOST_SOURCE.exec(source);
  if (host === null) return false;
  const expressionScheme = host[1];
  const expressionHost = host[2] ?? '';
  const expressionPort = host[3];
  const requiredScheme = expressionScheme ?? schemeOf(page);
  if (!schemeMatches(requiredScheme, schemeOf(admin))) return false;
  if (!hostMatches(expressionHost, admin.hostname)) return false;
  if (expressionPort === undefined) return admin.port === '';
  return expressionPort === '*' || expressionPort === portOf(admin);
}

/** Whether the directive admits `admin` as an ancestor of `page`. */
export function frameAncestorsAdmits(directive: string, admin: URL, page: URL): boolean {
  const sources = directive
    .split(/\s+/u)
    .slice(1)
    .filter((source) => source.length > 0)
    .map((source) => source.toLowerCase());
  if (sources.length === 0 || (sources.length === 1 && sources[0] === "'none'")) return false;
  for (const source of sources) {
    if (source === "'self'") {
      if (isSelf(admin, page)) return true;
    } else if (source === '*') {
      return true;
    } else if (!source.startsWith("'") && sourceMatches(source, admin, page)) {
      return true;
    }
  }
  return false;
}
