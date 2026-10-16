/**
 * Observe real Payload 2 ingress and unchanged browser fetch without copying
 * schema values or credentials. React and Vue reuse the native lifecycle
 * controls; the installed package owns v2 schema caching and population.
 */
export function ledger() {
  if (typeof window === 'undefined') return {};
  return (window.__r6 ??= {
    ready: false,
    document: '',
    target: 'primary',
    traffic: [],
    calls: [],
    commits: [],
    strictSetups: 0,
    strictCleanups: 0,
    scopeStarts: 0,
    scopeStops: 0,
    hydrationErrors: [],
    validationErrors: [],
    activeSession: null,
  });
}

export function installControls(admin) {
  const state = ledger();
  const observe = (event) => {
    if (
      event.origin !== admin ||
      event.source !== window.parent ||
      event.data?.type !== 'payload-live-preview' ||
      !event.data.data
    )
      return;
    const keys = ['type', 'data', 'fieldSchemaJSON', 'externallyUpdatedRelationship'];
    if (Object.keys(event.data).some((key) => !keys.includes(key))) {
      state.validationErrors.push('Unexpected v2 envelope key');
      return;
    }
    if (state.traffic.length >= 200) {
      state.validationErrors.push('Fixture ingress count exceeds its bound');
      return;
    }
    const data = event.data.data;
    state.traffic.push({
      parentSource: true,
      origin: event.origin,
      title: typeof data.title === 'string' ? data.title.slice(0, 2048) : null,
      author: typeof data.author === 'string' ? data.author.slice(0, 256) : null,
      schemaShape: Array.isArray(event.data.fieldSchemaJSON)
        ? 'array'
        : typeof event.data.fieldSchemaJSON === 'string'
          ? 'string'
          : event.data.fieldSchemaJSON === undefined
            ? 'absent'
            : 'other',
    });
  };
  window.addEventListener('message', observe);
  return () => window.removeEventListener('message', observe);
}

export async function observedFetch(input, init) {
  const state = ledger();
  if (state.calls.length >= 200) throw new Error('Fixture REST count exceeds its bound');
  const url = new URL(input instanceof Request ? input.url : String(input));
  const row = {
    path: url.pathname,
    query: url.search.slice(0, 2048),
    method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    aborted: init?.signal?.aborted === true,
    status: null,
    settled: false,
  };
  state.calls.push(row);
  const aborted = () => {
    row.aborted = true;
  };
  init?.signal?.addEventListener('abort', aborted, { once: true });
  try {
    const response = await fetch(input, init);
    row.status = response.status;
    return response;
  } catch (error) {
    row.error = error.name;
    throw error;
  } finally {
    row.settled = true;
    init?.signal?.removeEventListener('abort', aborted);
  }
}

export function initialData(document) {
  return { title: 'Initial ' + document, subtitle: 'Initial subtitle', author: null };
}

export function connection(admin) {
  return {
    serverURL: admin,
    allowedOrigins: [admin],
    depth: 1,
    fetchFn: observedFetch,
    eventSourcePolicy: 'parent-or-opener',
    enableReferrerDetection: false,
    enableLocalhostMatching: false,
  };
}
