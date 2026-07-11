/**
 * Protocol-drift watchdog — EXECUTES the real Payload client.
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
 * Run weekly in CI (`protocol-watch.yml`) against `@latest` and, as a
 * soft-fail early warning, `@canary`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE = process.env['PROTOCOL_WATCH_PACKAGE'] ?? '@payloadcms/live-preview@latest';

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
    assert('ready() targets serverURL', posted[0]?.origin === 'https://admin.example.com', String(posted[0]?.origin));
    assert("ready() type is 'payload-live-preview'", handshake?.type === 'payload-live-preview', String(handshake?.type));
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
      !client.isLivePreviewEvent({ origin: 'https://evil.example', data: { type: 'payload-live-preview' } }, SRV),
      'expected false',
    );
    assert(
      'isDocumentEvent accepts a save event',
      client.isDocumentEvent({ origin: SRV, data: { type: 'payload-document-event' } }, SRV),
      'expected true',
    );

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
    assert('mergeData URL matches endpoint pattern', call?.url === 'https://admin.example.com/api/posts/42', String(call?.url));
    assert('mergeData uses POST', call?.init.method === 'POST', String(call?.init.method));
    assert('mergeData sends credentials: include', call?.init.credentials === 'include', String(call?.init.credentials));
    const headers = (call?.init.headers ?? {}) as Record<string, string>;
    assert(
      'mergeData sends X-Payload-HTTP-Method-Override: GET',
      headers['X-Payload-HTTP-Method-Override'] === 'GET',
      JSON.stringify(headers),
    );
    const body = JSON.parse(
      typeof call?.init.body === 'string' ? call.init.body : '{}',
    ) as Record<string, unknown>;
    assert('mergeData body.flattenLocales is false', body['flattenLocales'] === false, String(body['flattenLocales']));
    assert('mergeData body.depth is passed through', body['depth'] === 1, String(body['depth']));
    assert('mergeData body.locale is passed through', body['locale'] === 'de', String(body['locale']));
    assert(
      'mergeData body.data is the incoming values',
      JSON.stringify(body['data']) === JSON.stringify({ id: '42', title: 'x' }),
      JSON.stringify(body['data']),
    );

    if (failures.length > 0) {
      console.error('[protocol-watch] PROTOCOL DRIFT DETECTED (executed behaviour changed):');
      for (const f of failures) console.error(`  ✗ ${f.check} — got ${f.detail}`);
      console.error(
        '[protocol-watch] Review src/core/message-bus.ts, src/core/data-merger.ts, ' +
          'src/types/payload-protocol.ts against the new @payloadcms/live-preview.',
      );
      process.exit(1);
    }
    console.log(
      `[protocol-watch] OK — executed ${PACKAGE}; ready handshake, event discriminators, ` +
        'and mergeData request all match our runtime invariants.',
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('[protocol-watch] script error:', err);
  process.exit(1);
});
