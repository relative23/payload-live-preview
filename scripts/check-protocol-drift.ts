/**
 * Protocol-drift watchdog — EXECUTES the real Payload client, and READS the
 * admin that talks to it.
 *
 * The executed half below was already good and still missed LP-1, because LP-1
 * is not in the receiver: the panel fills `externallyUpdatedRelationship` in
 * every message it sends, and the published package never sees that. So this
 * script also fetches the two files of Payload's *sender* and compares the
 * message objects they build against `tests/fixtures/protocol-model.ts`, which
 * holds each field's meaning next to its name. What that comparison cannot see
 * is written down in `scripts/payload-sender-model.ts`; the part it cannot see
 * at all — that a field repeats — is measured by `npm run test:protocol-semantics`.
 *
 * This library hand-mirrors Payload's live-preview postMessage protocol
 * (there is deliberately no `payload` dependency), so nothing breaks
 * loudly when Payload changes the wire format. Rather than string-match
 * dist files, this script downloads the latest `@payloadcms/live-preview`,
 * **imports and runs its real functions**, and asserts their actual
 * behaviour still matches the invariants our runtime implements:
 *
 *   - `ready({serverURL})` posts `{type:'payload-live-preview', ready:true}`
 *     to the parent — the exact handshake shape our MessageBus emits/accepts.
 *   - `isLivePreviewEvent` / `isDocumentEvent` discriminate on
 *     `event.data.type` and exact-origin — the discriminators our bus uses.
 *   - `mergeData`'s default request handler issues the exact REST request
 *     our `DataMerger` replicates: POST + `X-Payload-HTTP-Method-Override:
 *     GET`, `credentials: 'include'`, body `{data, depth, flattenLocales,
 *     locale}`, endpoint `[globals/]{slug}[/{id}]`.
 *
 * If Payload renames the header, flips `flattenLocales`, changes the
 * message type, or restructures the endpoint, an executed assertion
 * fails — a behavioural signal, not a brittle grep.
 *
 * Run nightly in CI (`protocol-watch.yml`) against `@latest` and, as a
 * soft-fail early warning, `@canary`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findFormViolations } from '../tests/fixtures/protocol-model';
import { readDeclaredProperties, readSenderMessages } from './payload-sender-model';
import { readSenderSources, SENDER_CHANNELS, WINDOW_PATH } from './payload-sender-source';

const PACKAGE = process.env['PROTOCOL_WATCH_PACKAGE'] ?? '@payloadcms/live-preview@latest';

/**
 * Where the failures are written for `scripts/report-protocol-drift.ts`, which
 * turns them into an issue. A file rather than the log, because the report has
 * to name each check and what it saw — parsing console output for that would be
 * a second, weaker copy of this script's own knowledge.
 */
const REPORT_PATH = process.env['PROTOCOL_WATCH_REPORT'] ?? 'protocol-drift.json';

/** The shape `report-protocol-drift.ts` reads; both sides are held by its test. */
export interface DriftReport {
  readonly package: string;
  readonly checkedAt: string;
  readonly failures: readonly Failure[];
}

interface Failure {
  readonly check: string;
  readonly detail: string;
}
const failures: Failure[] = [];
function assert(check: string, condition: boolean, detail: string): void {
  if (!condition) failures.push({ check, detail });
}

interface PayloadLivePreviewClient {
  ready: (args: { serverURL: string }) => void;
  isLivePreviewEvent: (event: { origin: string; data: unknown }, serverURL: string) => boolean;
  isDocumentEvent: (event: { origin: string; data: unknown }, serverURL: string) => boolean;
  mergeData: (args: Record<string, unknown>) => Promise<unknown>;
}

async function main(): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'protocol-watch-'));
  try {
    console.log(`[protocol-watch] packing ${PACKAGE} …`);
    const tarball = execFileSync('npm', ['pack', PACKAGE, '--pack-destination', workDir], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .pop();
    if (!tarball) throw new Error('npm pack produced no tarball name');
    execFileSync('tar', ['-xzf', join(workDir, tarball), '-C', workDir]);

    const distDir = join(workDir, 'package', 'dist');
    const entry = join(distDir, 'index.js');
    assert('package exports index.js', readdirSync(distDir).includes('index.js'), distDir);

    const client = (await import(pathToFileURL(entry).href)) as PayloadLivePreviewClient;

    // 1. Exports exist and are callable.
    for (const fn of ['ready', 'isLivePreviewEvent', 'isDocumentEvent', 'mergeData'] as const) {
      assert(`exports ${fn}`, typeof client[fn] === 'function', `typeof ${typeof client[fn]}`);
    }

    // 2. ready() posts the exact handshake our MessageBus emits/accepts.
    const posted: { message: unknown; origin: string }[] = [];
    const fakeParent = {
      postMessage: (message: unknown, origin: string) => posted.push({ message, origin }),
    };
    (globalThis as { window?: unknown }).window = { parent: fakeParent, opener: undefined };
    client.ready({ serverURL: 'https://admin.example.com' });
    delete (globalThis as { window?: unknown }).window;
    const handshake = posted[0]?.message as { type?: string; ready?: boolean } | undefined;
    assert(
      'ready() targets serverURL',
      posted[0]?.origin === 'https://admin.example.com',
      String(posted[0]?.origin),
    );
    assert(
      "ready() type is 'payload-live-preview'",
      handshake?.type === 'payload-live-preview',
      String(handshake?.type),
    );
    assert('ready() sets ready:true', handshake?.ready === true, String(handshake?.ready));

    // 3. Discriminators: exact-origin + type field, exactly as our bus routes.
    const SRV = 'https://admin.example.com';
    assert(
      'isLivePreviewEvent accepts a matching update',
      client.isLivePreviewEvent({ origin: SRV, data: { type: 'payload-live-preview' } }, SRV),
      'expected true',
    );
    assert(
      'isLivePreviewEvent rejects a foreign origin',
      !client.isLivePreviewEvent(
        { origin: 'https://evil.example', data: { type: 'payload-live-preview' } },
        SRV,
      ),
      'expected false',
    );
    assert(
      'isDocumentEvent accepts a save event',
      client.isDocumentEvent({ origin: SRV, data: { type: 'payload-document-event' } }, SRV),
      'expected true',
    );

    // 3b. The wire corpus: what real admins posted must still be what the
    // official client recognises, or the two sides of the protocol drifted.
    const corpusDir = join(process.cwd(), 'tests', 'fixtures', 'wire-corpus');
    for (const file of readdirSync(corpusDir)
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      const corpus = JSON.parse(readFileSync(join(corpusDir, file), 'utf8')) as {
        payload: string;
        adminOrigin: string;
        messages: { type: string }[];
      };
      for (const [index, message] of corpus.messages.entries()) {
        const event = { origin: corpus.adminOrigin, data: message };
        const recognised =
          message.type === 'payload-document-event'
            ? client.isDocumentEvent(event, corpus.adminOrigin)
            : client.isLivePreviewEvent(event, corpus.adminOrigin);
        assert(
          `corpus ${corpus.payload} #${String(index)} (${message.type}) is recognised by ${PACKAGE}`,
          recognised,
          JSON.stringify(message).slice(0, 120),
        );
      }
      console.log(
        `[protocol-watch] corpus ${corpus.payload}: ${String(corpus.messages.length)} messages recognised`,
      );
    }
    // 4. mergeData's default handler issues the request our DataMerger replicates.
    const calls: { url: string; init: RequestInit }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as unknown as Response);
    }) as typeof fetch;
    try {
      await client.mergeData({
        serverURL: SRV,
        apiRoute: '/api',
        collectionSlug: 'posts',
        globalSlug: undefined,
        depth: 1,
        locale: 'de',
        incomingData: { id: '42', title: 'x' },
        initialData: { id: '42' },
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    const call = calls[0];
    assert('mergeData issued one request', calls.length === 1, `got ${calls.length}`);
    assert(
      'mergeData URL matches endpoint pattern',
      call?.url === 'https://admin.example.com/api/posts/42',
      String(call?.url),
    );
    assert('mergeData uses POST', call?.init.method === 'POST', String(call?.init.method));
    assert(
      'mergeData sends credentials: include',
      call?.init.credentials === 'include',
      String(call?.init.credentials),
    );
    const headers = (call?.init.headers ?? {}) as Record<string, string>;
    assert(
      'mergeData sends X-Payload-HTTP-Method-Override: GET',
      headers['X-Payload-HTTP-Method-Override'] === 'GET',
      JSON.stringify(headers),
    );
    const body = JSON.parse(typeof call?.init.body === 'string' ? call.init.body : '{}') as Record<
      string,
      unknown
    >;
    assert(
      'mergeData body.flattenLocales is false',
      body['flattenLocales'] === false,
      String(body['flattenLocales']),
    );
    assert('mergeData body.depth is passed through', body['depth'] === 1, String(body['depth']));
    assert(
      'mergeData body.locale is passed through',
      body['locale'] === 'de',
      String(body['locale']),
    );
    assert(
      'mergeData body.data is the incoming values',
      JSON.stringify(body['data']) === JSON.stringify({ id: '42', title: 'x' }),
      JSON.stringify(body['data']),
    );

    // 5. The sender: the message object the admin builds, out of their source.
    //    The dist-tag under test picks the channel; a pinned version has none,
    //    and reading `latest` instead would quietly answer a different question.
    const distTag = PACKAGE.split('@').pop() ?? '';
    const channel = SENDER_CHANNELS.find((candidate) => candidate.distTag === distTag);
    if (channel === undefined) {
      console.log(`[protocol-watch] sender not read: ${distTag} is not a channel`);
    } else {
      const senderDir = mkdtempSync(join(tmpdir(), 'protocol-sender-'));
      try {
        const sources = readSenderSources(channel, senderDir);
        console.log(
          `[protocol-watch] sender ${channel.distTag} = ${sources.version} @ ${sources.ref}` +
            (sources.exact ? '' : ' (branch: canary builds carry no tag)'),
        );
        const built = readSenderMessages(WINDOW_PATH, sources.window);
        const declared = readDeclaredProperties(sources.types);
        assert(
          `sender ${channel.distTag} still builds a message`,
          built.length > 0,
          `no object literal with a payload- type in ${WINDOW_PATH}`,
        );
        for (const violation of findFormViolations(built, declared)) {
          failures.push({
            check: `sender ${channel.distTag}: ${violation.what}`,
            detail: violation.detail,
          });
        }
      } finally {
        rmSync(senderDir, { recursive: true, force: true });
      }
    }

    if (failures.length > 0) {
      const report: DriftReport = {
        package: PACKAGE,
        checkedAt: new Date().toISOString(),
        failures,
      };
      writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.error('[protocol-watch] PROTOCOL DRIFT DETECTED (executed behaviour changed):');
      for (const f of failures) console.error(`  ✗ ${f.check} — got ${f.detail}`);
      console.error(
        '[protocol-watch] Review src/core/message-bus.ts, src/core/data-merger.ts, ' +
          'src/types/payload-protocol.ts against the new @payloadcms/live-preview, ' +
          'and tests/fixtures/protocol-model.ts against the new admin.',
      );
      process.exit(1);
    }
    console.log(
      `[protocol-watch] OK — executed ${PACKAGE}; ready handshake, event discriminators, ` +
        "mergeData request and the admin's message objects all match the model.",
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('[protocol-watch] script error:', err);
  process.exit(1);
});
