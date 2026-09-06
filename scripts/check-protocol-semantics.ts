/**
 * The semantics gate: replays each recorded wire corpus through the real
 * runtime and holds what the protocol *means*, not what it looks like.
 *
 * The form half lives in the protocol watch, which reads Payload's sender. This
 * half needs traffic, because the claim that sank LP-1 — "`externallyUpdated-
 * Relationship` repeats and usually names the previewed document itself" — is
 * invisible in a type and in a single message. It is visible in a session that
 * crossed a save, so that is what a corpus must contain and what this gate
 * counts. No network: jsdom, the merge endpoint echoes, both numbers are ours.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  findExceptionViolations,
  findSemanticViolations,
  PROTOCOL_MODEL,
  SEMANTIC_BUDGETS,
  type ProtocolViolation,
  type SemanticMeasurement,
} from '../tests/fixtures/protocol-model';

const CORPUS_DIR = resolve('tests/fixtures/wire-corpus');
const PREVIEW = 'http://localhost:4173/';
/** One idle turn between messages, so each becomes its own revision as in an admin. */
const BETWEEN_MESSAGES_MS = 15;
/** Long enough for the last update's writes to have landed. */
const SETTLE_MS = 150;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** jsdom has no layout; every replayed page is one paragraph. */
class NoIntersections {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

/**
 * Publish one jsdom window as the globals the runtime reads. `opener` points at
 * the window itself so the 2.0 source policy has a window it can accept; this
 * process has no second realm to post from, and which windows may post is a
 * message-bus decision with its own tests.
 */
function installDom(dom: JSDOM): Window & typeof globalThis {
  const win = dom.window as unknown as Window & typeof globalThis;
  for (const key of Object.getOwnPropertyNames(win)) {
    if (key in globalThis) continue;
    try {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        get: () => (win as unknown as Record<string, unknown>)[key],
      });
    } catch {
      // A few jsdom accessors refuse redefinition; nothing the runtime reads.
    }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: NoIntersections,
  });
  Object.defineProperty(win, 'opener', { configurable: true, value: win });
  return win;
}

interface Corpus {
  readonly payload: string;
  readonly adminOrigin: string;
  readonly messages: readonly Record<string, unknown>[];
}

interface RelationshipEvent {
  readonly entitySlug?: unknown;
  readonly id?: unknown;
  readonly updatedAt?: unknown;
}

/**
 * The identity Z1 has to build. Deliberately not `id` alone: a global carries
 * none, and an identity that requires one would call every global's save a new
 * document.
 */
function identity(event: RelationshipEvent): string {
  return JSON.stringify([event.entitySlug, event.id, event.updatedAt]);
}

function updates(corpus: Corpus): readonly Record<string, unknown>[] {
  return corpus.messages.filter((message) => message['type'] === 'payload-live-preview');
}

/** Fields the capture carries as plain strings, so the page has something to bind. */
function boundPage(corpus: Corpus): string {
  const names = new Set<string>();
  for (const message of updates(corpus)) {
    const data = message['data'];
    if (typeof data !== 'object' || data === null) continue;
    for (const [name, value] of Object.entries(data)) {
      if (typeof value === 'string') names.add(name);
    }
  }
  return [...names].map((name) => `<p data-payload-field="${name}"></p>`).join('');
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: PREVIEW,
  pretendToBeVisual: true,
});
const win = installDom(dom);
const { LivePreviewClient } = await import('../src/client-entry');

async function replay(corpus: Corpus): Promise<SemanticMeasurement> {
  win.document.body.innerHTML = boundPage(corpus);
  const client = new LivePreviewClient({
    allowedOrigins: [corpus.adminOrigin],
    serverURL: corpus.adminOrigin,
    debug: false,
    mergeDepth: 1,
    debounceMs: 0,
    // The merger exists to populate relationships; a corpus replay has no
    // server, so the posted values come back untouched.
    mergeFetch: (_input, init) => {
      const sent: unknown = init?.body;
      const body = JSON.parse(typeof sent === 'string' ? sent : '{}') as { data?: unknown };
      return Promise.resolve(
        new Response(JSON.stringify(body.data ?? {}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  if (!client.inspect().started) throw new Error(`${corpus.payload}: the runtime did not start`);
  let relationshipUpdates = 0;
  client.events.on('relationshipUpdate', () => {
    relationshipUpdates += 1;
  });
  try {
    // Snapshotted just before the first message that carries the field, so the
    // skip count below is the post-save half alone.
    let beforeFirstCarrying: number | undefined;
    for (const message of corpus.messages) {
      if (beforeFirstCarrying === undefined && message['externallyUpdatedRelationship'] != null) {
        beforeFirstCarrying = client.inspect().revisions.skippedUnchanged;
      }
      win.dispatchEvent(
        new win.MessageEvent('message', {
          data: message,
          origin: corpus.adminOrigin,
          source: win as unknown as Window,
        }),
      );
      await sleep(BETWEEN_MESSAGES_MS);
    }
    await sleep(SETTLE_MS);
    const carrying = updates(corpus).filter(
      (message) => message['externallyUpdatedRelationship'] != null,
    );
    const documents = new Set(
      carrying.map((message) =>
        identity(message['externallyUpdatedRelationship'] as RelationshipEvent),
      ),
    );
    const skipped = client.inspect().revisions.skippedUnchanged;
    return {
      carrying: carrying.length,
      distinctDocuments: documents.size,
      relationshipUpdates,
      skippedAfterSave: beforeFirstCarrying === undefined ? 0 : skipped - beforeFirstCarrying,
    };
  } finally {
    await client.destroy();
  }
}

/**
 * A treatment nobody holds is a sentence, not a contract. Every `heldBy` must
 * name a file that exists or a script that is defined.
 */
function findHolderViolations(): readonly ProtocolViolation[] {
  const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const violations: ProtocolViolation[] = [];
  for (const message of PROTOCOL_MODEL) {
    for (const field of message.fields) {
      const holder = field.heldBy;
      const named = holder.startsWith('npm run ')
        ? holder.slice('npm run '.length) in manifest.scripts
        : readdirSync(resolve(holder, '..')).includes(holder.split('/').at(-1) ?? '');
      if (named) continue;
      violations.push({
        what: `${message.type}.${field.name} is held by nothing that exists`,
        detail: holder,
      });
    }
  }
  return violations;
}

function report(label: string, violations: readonly ProtocolViolation[]): number {
  console.log(`${violations.length === 0 ? 'PASS' : 'FAIL'} ${label}`);
  for (const violation of violations) {
    console.error(`  ${violation.what}`);
    console.error(`    ${violation.detail}`);
  }
  return violations.length;
}

async function main(): Promise<void> {
  let failures = report(
    'the exception book names a task for every exception',
    findExceptionViolations(),
  );
  failures += report('every treatment names a gate that exists', findHolderViolations());

  const files = readdirSync(CORPUS_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const measured = new Set<string>();
  for (const file of files) {
    const corpus = JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8')) as Corpus;
    measured.add(corpus.payload);
    const measurement = await replay(corpus);
    failures += report(
      `Payload ${corpus.payload}: ${measurement.carrying} carrying / ` +
        `${measurement.distinctDocuments} distinct / ${measurement.relationshipUpdates} events / ` +
        `${measurement.skippedAfterSave} skipped after the save`,
      findSemanticViolations(corpus.payload, measurement),
    );
  }
  for (const budget of SEMANTIC_BUDGETS) {
    if (measured.has(budget.corpus)) continue;
    failures += report(`a budget for a corpus the gate does not replay: ${budget.corpus}`, [
      { what: budget.metric, detail: budget.reason },
    ]);
  }
  dom.window.close();
  if (failures > 0) throw new Error(`protocol semantics gate failed with ${failures} violation(s)`);
}

await main();
