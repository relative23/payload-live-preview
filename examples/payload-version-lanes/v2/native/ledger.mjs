/**
 * Passive observations distinguish native owners in one receiver document. Only closed metadata
 * leaves this module; the installed SDK still owns every subscription, schema, abort and merge,
 * and fetch is delegated unchanged. The v2 browser probes read the record through
 * window.__r6Witness.export(), so no error text or header reaches a report; the one free text it
 * keeps is the bounded title of a message it turned away, as the v3 record does. A few switches
 * the specs set before the page runs (window.__r6Knobs) change how the hook is configured, never
 * what it does: the source policy, further allowed origins and a fetch that ignores the abort.
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
  'target-switch',
  'sign-out',
  'sign-in',
  'final',
];

// The switches of the specs, or none when the page has no window or no spec set them.
const knobs = () => (typeof window === 'undefined' ? {} : (window.__r6Knobs ?? {}));

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
      target: 'primary',
      traffic: [],
      refusedTraffic: [],
      foreignOrigin: 0,
      observedWindows: new WeakSet(),
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

// A short public string or nothing: an origin, or the marker title a spec gave a message.
const publicText = (value, longest) =>
  typeof value === 'string' && value.length <= longest ? value : undefined;

// What the record keeps of a message it turned away, like the v3 record: the receiver, the sender's
// origin, the marker title and why. Never the data of the form.
const refusal = (label, event, reason) => ({
  seq: next(),
  target: label,
  origin: publicText(event.origin, 256),
  marker: publicText(event.data.data.title, 2048),
  reason,
});

// The messages one window may receive. The record keeps what this module itself accepts as the
// admin's message and what it turns away, and whether the hook took a message is read from what the
// hook then did. A message of the right type from another origin is counted, never listed as traffic.
function observeInbox(inbox, label, admin) {
  const state = ledger();
  if (state.observedWindows.has(inbox)) return;
  state.observedWindows.add(inbox);
  inbox.addEventListener('message', (event) => {
    if (event.data?.type !== 'payload-live-preview' || !event.data.data) return;
    if (event.origin !== admin) {
      state.foreignOrigin = Math.min(LIMIT + 1, state.foreignOrigin + 1);
      append('refusedTraffic', refusal(label, event, 'foreign-origin'));
      return;
    }
    if (event.source !== inbox.parent) {
      append('refusedTraffic', refusal(label, event, 'wrong-source'));
      return;
    }
    const keys = ['type', 'data', 'fieldSchemaJSON', 'externallyUpdatedRelationship'];
    if (Object.keys(event.data).some((key) => !keys.includes(key))) {
      state.validationErrors.push();
      return;
    }
    append('traffic', {
      seq: next(),
      target: label,
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
  });
}

// The admin document can name a second direct child of its own as the receiver: the app starts a
// hook on that window and this module watches it too. The window has to share the preview's origin.
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
    if (target.location.origin !== location.origin)
      throw new Error('Target must share the preview origin');
    observeInbox(target, 'secondary', admin);
    ledger().target = 'secondary';
    selectTarget?.(target, event.data.index);
  };
  window.addEventListener('message', control);
  return () => window.removeEventListener('message', control);
}

async function observedFetch(owner, input, init, label, stubborn) {
  if (!owner) return fetch(input, init);
  const state = ledger();
  if (state.calls.length >= LIMIT) throw new Error('Fixture REST count exceeds its bound');
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const row = {
    id: state.calls.length + 1,
    owner: owner.id,
    target: label,
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
    // A stubborn consumer's fetch ignores the signal: the record still sees the abort, the browser's
    // request goes on and its answer arrives late, which is what the late-answer cases need.
    const response = await fetch(input, stubborn ? { ...init, signal: undefined } : init);
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
    target: state.target,
    traffic: state.traffic,
    refusedTraffic: state.refusedTraffic,
    foreignOrigin: state.foreignOrigin,
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

export function connection(admin, target, owner) {
  const { fetch: fetchMode, origins, policy } = knobs();
  const label = target === undefined ? 'primary' : 'secondary';
  return {
    serverURL: admin,
    allowedOrigins: [admin, ...(origins ?? [])],
    depth: 1,
    fetchFn: (input, init) => observedFetch(owner, input, init, label, fetchMode === 'stubborn'),
    eventSourcePolicy: policy ?? 'parent-or-opener',
    enableReferrerDetection: false,
    enableLocalhostMatching: false,
    ...(target === undefined ? {} : { target }),
  };
}
