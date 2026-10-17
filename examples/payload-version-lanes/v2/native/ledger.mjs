/**
 * Passive observations distinguish native owners in one receiver document. Only closed metadata
 * leaves this module; the installed SDK still owns every subscription, schema, abort and merge,
 * and fetch is delegated unchanged. Both v2 browser probes read the record through
 * window.__r6Witness.export(), so no error text or header reaches a report.
 */
const LIMIT = 200;
const seeds = new WeakMap();
// The title the document-change case types into the first document: a commit that still shows it
// after the switch would be the old document leaking into the new owner.
const OLD_DOCUMENT_TITLE = 'Unsaved old v2 document';
// The checkpoints the specs may name; an unknown phase is a fixture error, not a new row.
const PHASES = [
  'initial',
  'route-held',
  'restart-click',
  'fresh-owner',
  'release',
  'route-callback-ended',
  'schema-absent',
  'before-parent-restart',
  'provider-recovery',
  'other-document',
  'child-reload-initial',
  'final',
];

// The hydration and validation hooks only count: the report carries the number, never the text.
// The object holds a function, so the export below copies the count and not the object.
function errorCount() {
  return {
    length: 0,
    push() {
      this.length = Math.min(LIMIT + 1, this.length + 1);
    },
  };
}

export function ledger() {
  if (typeof window === 'undefined') return null;
  if (!window.__r6) {
    window.__r6 = {
      ready: false,
      document: '',
      sequence: 0,
      owners: [],
      traffic: [],
      calls: [],
      snapshots: [],
      commits: [],
      phases: [],
      strictSetups: 0,
      strictCleanups: 0,
      scopeStarts: 0,
      scopeStops: 0,
      hydrationErrors: errorCount(),
      validationErrors: errorCount(),
      activeSession: null,
    };
    window.__r6Witness = { checkpoint, export: exportWitness };
  }
  return window.__r6;
}

function next() {
  const state = ledger();
  return state ? ++state.sequence : 0;
}

function append(key, row) {
  const state = ledger();
  if (!state) return;
  if (state[key].length >= LIMIT) state.validationErrors.push();
  else state[key].push(row);
}

export function beginOwner(surface, document, generation, seed) {
  const state = ledger();
  if (!state) return null;
  const owner = {
    id: state.owners.length + 1,
    surface,
    document,
    generation,
    bornSeq: next(),
    bornIngressCount: state.traffic.length,
    firstSnapshotSeq: null,
    initialOwnData: null,
    initialRevision: null,
    initialStatus: null,
    initialLoading: null,
    initialBeforeIngress: null,
    setups: [],
    cleanups: [],
    active: false,
  };
  seeds.set(owner, seed);
  append('owners', owner);
  return owner;
}

export function ownerSetup(owner) {
  if (!owner) return;
  if (owner.setups.length >= LIMIT) ledger().validationErrors.push();
  else owner.setups.push(next());
  owner.active = true;
}

export function ownerCleanup(owner) {
  if (!owner) return;
  if (owner.cleanups.length >= LIMIT) ledger().validationErrors.push();
  else owner.cleanups.push(next());
  owner.active = false;
}

export function observeSnapshot(owner, snapshot, stage) {
  if (!owner) return;
  const state = ledger();
  const row = {
    seq: next(),
    owner: owner.id,
    stage,
    revision: snapshot.revision,
    status: snapshot.status,
    isLoading: snapshot.isLoading,
    ownInitialData: snapshot.data === seeds.get(owner),
    errorPresent: snapshot.error !== undefined,
    oldDocumentMarker: snapshot.data.title === OLD_DOCUMENT_TITLE,
  };
  if (owner.firstSnapshotSeq === null) {
    owner.firstSnapshotSeq = row.seq;
    owner.initialOwnData = row.ownInitialData;
    owner.initialRevision = row.revision;
    owner.initialStatus = row.status;
    owner.initialLoading = row.isLoading;
    owner.initialBeforeIngress = state.traffic.length === owner.bornIngressCount;
  }
  append('snapshots', row);
  state.activeSession = row;
}

export function commitSnapshot(owner, snapshot) {
  if (!owner || snapshot.revision <= 0 || snapshot.isLoading || snapshot.status !== 'live') return;
  append('commits', {
    seq: next(),
    owner: owner.id,
    document: owner.document,
    revision: snapshot.revision,
    oldDocumentMarker: snapshot.data.title === OLD_DOCUMENT_TITLE,
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
      state.validationErrors.push();
      return;
    }
    append('traffic', {
      seq: next(),
      parentSource: true,
      originMatchesAdmin: true,
      schemaShape: Array.isArray(event.data.fieldSchemaJSON)
        ? 'array'
        : typeof event.data.fieldSchemaJSON === 'string'
          ? 'string'
          : event.data.fieldSchemaJSON === undefined
            ? 'absent'
            : 'other',
      hasExplicitTarget:
        Object.hasOwn(event.data, 'collectionSlug') || Object.hasOwn(event.data, 'globalSlug'),
    });
  };
  window.addEventListener('message', observe);
  return () => window.removeEventListener('message', observe);
}

async function observedFetch(owner, input, init) {
  if (!owner) return fetch(input, init);
  const state = ledger();
  if (state.calls.length >= LIMIT) throw new Error('Fixture REST count exceeds its bound');
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const row = {
    id: state.calls.length + 1,
    owner: owner.id,
    startSeq: next(),
    authorPopulation: url.pathname === '/api/authors' && url.searchParams.has('where[id][in]'),
    method: method === 'GET' || method === 'POST' ? method : 'other',
    aborted: init?.signal?.aborted === true,
    abortSeq: null,
    status: null,
    threw: false,
    settled: false,
    settledSeq: null,
    activeOwnersAtSettlement: [],
  };
  append('calls', row);
  const aborted = () => {
    row.aborted = true;
    row.abortSeq = next();
  };
  init?.signal?.addEventListener('abort', aborted, { once: true });
  try {
    const response = await fetch(input, init);
    row.status = response.status;
    return response;
  } catch (error) {
    row.threw = true;
    throw error;
  } finally {
    row.settled = true;
    row.settledSeq = next();
    row.activeOwnersAtSettlement = state.owners
      .filter((value) => value.active)
      .map((value) => value.id);
    init?.signal?.removeEventListener('abort', aborted);
  }
}

function checkpoint(phase) {
  if (!PHASES.includes(phase)) {
    ledger().validationErrors.push();
    return null;
  }
  const seq = next();
  append('phases', { phase, seq });
  return seq;
}

function exportWitness() {
  const state = ledger();
  return structuredClone({
    schemaVersion: 1,
    ready: state.ready,
    document: state.document,
    sequence: state.sequence,
    owners: state.owners,
    traffic: state.traffic,
    calls: state.calls,
    snapshots: state.snapshots,
    commits: state.commits,
    phases: state.phases,
    strictSetups: state.strictSetups,
    strictCleanups: state.strictCleanups,
    scopeStarts: state.scopeStarts,
    scopeStops: state.scopeStops,
    hydrationErrorCount: state.hydrationErrors.length,
    validationErrorCount: state.validationErrors.length,
    activeSession: state.activeSession,
  });
}

export function initialData(document) {
  return { title: 'Initial ' + document, subtitle: 'Initial subtitle', author: null };
}

export function connection(admin, _target, owner) {
  return {
    serverURL: admin,
    allowedOrigins: [admin],
    depth: 1,
    fetchFn: (input, init) => observedFetch(owner, input, init),
    eventSourcePolicy: 'parent-or-opener',
    enableReferrerDetection: false,
    enableLocalhostMatching: false,
  };
}
