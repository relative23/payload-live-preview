/**
 * The ledger observes real admin traffic and the browser's unchanged fetch.
 * It contains public fixture markers and counters, never cookies or headers;
 * the hook/composable remains the installed package implementation.
 */
export function ledger() {
  if (typeof window === 'undefined') return {};
  return (window.__r6 ??= {
    ready: false,
    document: '',
    target: 'primary',
    calls: [],
    traffic: [],
    commits: [],
    refusedTraffic: [],
    strictSetups: 0,
    strictCleanups: 0,
    scopeStarts: 0,
    scopeStops: 0,
    hydrationErrors: [],
    validationErrors: [],
    wireMetadata: [],
    observedWindows: new WeakSet(),
    activeSession: null,
  });
}

const MESSAGE_KEYS = new Set([
  'type',
  'collectionSlug',
  'data',
  'externallyUpdatedRelationship',
  'globalSlug',
  'locale',
]);
const DATA_KEYS = new Set([
  'title',
  'subtitle',
  'author',
  'id',
  'globalType',
  'createdAt',
  'updatedAt',
  // Payload 4.0.0-beta.4 adds hidden authorship relationships to every global. The form
  // posts both keys, undefined until a signed-in user saves; JSON captures drop them.
  'createdBy',
  'updatedBy',
]);
// Key names go into the ledger only in this shape, never a value.
const PUBLIC_KEY = /^[a-zA-Z0-9_-]{1,64}$/u;
const publicMarker = (value) =>
  typeof value === 'string' && value.length <= 2048 ? value : undefined;

export function schemaShape(value) {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  return value === undefined ? 'absent' : 'other';
}

function fixtureMessage(value) {
  // This fixture owns three simple fields, two globals and no drawer events.
  // Unexpected schema/credential fields fail the probe before any replay is retained.
  if (Object.keys(value).some((key) => !MESSAGE_KEYS.has(key)))
    throw new Error('Unexpected message key');
  if (!value.data || Array.isArray(value.data) || typeof value.data !== 'object')
    throw new Error('Expected field record');
  const unexpected = Object.keys(value.data).find((key) => !DATA_KEYS.has(key));
  if (unexpected !== undefined)
    throw new Error('Unexpected field key ' + (PUBLIC_KEY.test(unexpected) ? unexpected : '?'));
  if (!['homepage', 'otherpage'].includes(value.globalSlug)) throw new Error('Unexpected global');
  if (value.collectionSlug !== undefined || value.externallyUpdatedRelationship != null)
    throw new Error('Unexpected collection/drawer event');
  if (value.locale !== undefined && (typeof value.locale !== 'string' || value.locale.length > 64))
    throw new Error('Unexpected locale');
  for (const field of Object.values(value.data)) {
    if (field == null) continue;
    if (typeof field === 'number' && Number.isFinite(field)) continue;
    if (typeof field === 'string' && field.length <= 2048) continue;
    throw new Error('Expected bounded public fixture scalar');
  }
  if (typeof value.data.title !== 'string') throw new Error('Expected title marker');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384)
    throw new Error('Message exceeds fixture limit');
  return structuredClone(value);
}

export function observeInbox(target, label, admin) {
  const state = ledger();
  if (state.observedWindows.has(target)) return;
  state.observedWindows.add(target);
  target.addEventListener('message', (event) => {
    if (
      event.origin === admin &&
      event.source === target.parent &&
      typeof event.data?.type === 'string'
    ) {
      const type = event.data.type.slice(0, 128);
      if (
        ['payload-live-preview', 'payload-document-event'].includes(type) &&
        state.wireMetadata.length < 128
      ) {
        state.wireMetadata.push({
          receiver: label,
          type,
          parentSource: true,
          keys: Object.keys(event.data)
            .filter((key) => PUBLIC_KEY.test(key))
            .slice(0, 24)
            .sort(),
          schemaShape: schemaShape(event.data.fieldSchemaJSON),
          schemaJSON: ['array', 'string'].includes(schemaShape(event.data.fieldSchemaJSON)),
          relationshipEvent: event.data.externallyUpdatedRelationship != null,
          globalSlug: ['homepage', 'otherpage'].includes(event.data.globalSlug)
            ? event.data.globalSlug
            : undefined,
        });
      }
    }
    if (event.origin !== admin || event.data?.type !== 'payload-live-preview' || !event.data.data)
      return;
    if (event.source !== target.parent) {
      // Keep only the public countercheck marker, never a foreign replay payload.
      state.refusedTraffic.push({
        target: label,
        origin: event.origin,
        marker: publicMarker(event.data.data.title),
        reason: 'wrong-source',
      });
      return;
    }
    let message;
    try {
      message = fixtureMessage(event.data);
    } catch (error) {
      state.validationErrors.push(error.message);
      return;
    }
    state.traffic.push({
      target: label,
      origin: event.origin,
      parentSource: true,
      marker: message.data.title,
      message,
    });
  });
}

export function installControls(admin, selectTarget) {
  observeInbox(window, 'primary', admin);
  const control = (event) => {
    if (
      event.origin !== admin ||
      event.source !== window.parent ||
      event.data?.type !== 'r6-control'
    )
      return;
    if (event.data.action !== 'target' || !Number.isSafeInteger(event.data.index)) return;
    const target = window.parent.frames[event.data.index];
    if (!target || target === window)
      throw new Error('The target control needs a second direct admin child');
    // A Window target is a receiver. Its parent remains the actual admin; no
    // relay origin or permissive source policy is needed for this countercheck.
    if (target.location.origin !== location.origin)
      throw new Error('Target must share the preview origin');
    observeInbox(target, 'secondary', admin);
    ledger().target = 'secondary';
    selectTarget(target, event.data.index);
  };
  window.addEventListener('message', control);
  return () => window.removeEventListener('message', control);
}

export async function observedFetch(input, init) {
  const state = ledger();
  let marker;
  // A control fetch need not have JSON. Observation never changes native fetch
  // inputs or turns a valid GET into an exception in this diagnostic wrapper.
  if (typeof init?.body === 'string') {
    try {
      marker = publicMarker(JSON.parse(init.body)?.data?.title);
    } catch {
      /* No public JSON marker. */
    }
  }
  const url = new URL(input instanceof Request ? input.url : String(input));
  const row = {
    index: state.calls.length,
    path: url.pathname,
    marker,
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
  return { globalType: document, title: 'Initial ' + document, subtitle: 'Initial subtitle' };
}

export function connection(admin, target) {
  return {
    serverURL: admin,
    allowedOrigins: [admin],
    depth: 1,
    fetchFn: observedFetch,
    eventSourcePolicy: 'parent-or-opener',
    enableReferrerDetection: false,
    enableLocalhostMatching: false,
    ...(target === undefined ? {} : { target }),
  };
}
