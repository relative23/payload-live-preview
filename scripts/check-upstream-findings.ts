/**
 * The seven behaviours `docs/react.md` measures this package's hook against,
 * reproduced on the *published* `@payloadcms/live-preview` dist.
 *
 * `tests/unit/adapters/payload-hook-comparison.test.ts` asserts five of them
 * against the devDependency, in jsdom, inside the suite. This script asks the
 * other half of the question: does the version a user installs *today* still
 * behave that way? It packs the dist-tag from the registry, imports the real
 * `dist/index.js` into a synthetic window and runs each case end to end.
 *
 * It is therefore not part of `npm run check` or `npm run build`. It needs the
 * network and someone else's registry, and a gate that turns red when a mirror
 * is slow is not a gate. It runs in `protocol-watch.yml`, beside the drift
 * watch, which is where this repository already asks questions about a package
 * it does not own.
 *
 * A red run here is usually *good* news: the recorded observation is what the
 * published package did when the comparison was written, so a mismatch means
 * upstream changed. Then the row in `docs/react.md` and the case in
 * `payload-hook-comparison.test.ts` are stale and go, rather than staying up as
 * a claim about a package that has moved on.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE = process.env['UPSTREAM_FINDINGS_PACKAGE'] ?? '@payloadcms/live-preview@latest';

const SERVER = 'https://cms.example.com';

/** What their `requestHandler` contract hands a caller, and what it must return. */
interface RequestArgs {
  readonly endpoint: string;
  readonly serverURL: string;
  readonly apiRoute: string;
  readonly method: string;
  readonly data: { data: Record<string, unknown> };
}
type RequestHandler = (args: RequestArgs) => Promise<{ json: () => Promise<unknown> }>;

interface SubscribeArgs {
  readonly callback: (data: Record<string, unknown>) => void;
  readonly initialData: Record<string, unknown>;
  readonly serverURL: string;
  readonly requestHandler: RequestHandler;
  readonly apiRoute?: string;
  readonly depth?: number;
}

type Listener = (event: { origin: string; data: unknown }) => Promise<unknown>;

interface UpstreamClient {
  subscribe: (args: SubscribeArgs) => Listener;
}

/** The window `subscribe` attaches to; one per case, so no case leaks into the next. */
class FakeWindow {
  readonly #listeners: Listener[] = [];
  readonly parent = { postMessage: (): void => {} };

  addEventListener(type: string, fn: Listener): void {
    if (type === 'message') this.#listeners.push(fn);
  }

  removeEventListener(_type: string, fn: Listener): void {
    const at = this.#listeners.indexOf(fn);
    if (at >= 0) this.#listeners.splice(at, 1);
  }

  /** Awaits every listener, so a rejection from their async listener surfaces here. */
  async deliver(data: unknown, origin = SERVER): Promise<void> {
    await Promise.all(this.#listeners.map((fn) => fn({ origin, data })));
  }
}

/** An update message as the admin posts it: raw form values, no schema. `null` omits the slug. */
function update(fields: Record<string, unknown>, slug: string | null = 'posts'): unknown {
  return {
    type: 'payload-live-preview',
    ...(slug === null ? {} : { collectionSlug: slug }),
    data: { id: 1, ...fields },
  };
}

/** Echoes the posted title back as the merged document, the way a healthy REST route would. */
const echo: RequestHandler = ({ data }) =>
  Promise.resolve({ json: () => Promise.resolve({ id: 1, ...data.data, merged: true }) });

interface Finding {
  /** The identifier the comparison in `docs/react.md` uses. */
  readonly id: string;
  readonly what: string;
  /** What the published package did when the comparison was written. */
  readonly recorded: string;
  readonly run: (client: UpstreamClient, w: FakeWindow) => Promise<string>;
}

const FINDINGS: readonly Finding[] = [
  {
    id: '1 trailing slash',
    what: "serverURL 'https://cms.example.com/' against an event from 'https://cms.example.com'",
    recorded: 'merges: no, callbacks: ["INITIAL"]',
    run: async (client, w) => {
      const seen: string[] = [];
      let merges = 0;
      client.subscribe({
        callback: (d) => seen.push(String(d['title'])),
        initialData: { id: 1, title: 'INITIAL' },
        serverURL: `${SERVER}/`,
        requestHandler: (args) => {
          merges += 1;
          return echo(args);
        },
      });
      await w.deliver(update({ title: 'TYPED' }));
      return `merges: ${merges > 0 ? 'yes' : 'no'}, callbacks: ${JSON.stringify(seen)}`;
    },
  },
  {
    id: '2 two previews on one page',
    what: 'two subscribers with different documents, then a message neither owns',
    recorded: 'A sees DOC-A, B sees DOC-A',
    run: async (client, w) => {
      const a: string[] = [];
      const b: string[] = [];
      const common = { serverURL: SERVER, requestHandler: echo };
      client.subscribe({
        callback: (d) => a.push(String(d['title'])),
        initialData: { id: 1, title: 'DOC-A' },
        ...common,
      });
      client.subscribe({
        callback: (d) => b.push(String(d['title'])),
        initialData: { id: 2, title: 'DOC-B' },
        ...common,
      });
      await w.deliver({ type: 'something-else' });
      return `A sees ${a.at(-1) ?? '—'}, B sees ${b.at(-1) ?? '—'}`;
    },
  },
  {
    id: '3 no slug at all',
    what: 'a message with neither collectionSlug nor globalSlug',
    recorded: 'requests: 0, last callback: INITIAL',
    run: async (client, w) => {
      const seen: string[] = [];
      let requests = 0;
      client.subscribe({
        callback: (d) => seen.push(String(d['title'])),
        initialData: { id: 1, title: 'INITIAL' },
        serverURL: SERVER,
        requestHandler: (args) => {
          requests += 1;
          return echo(args);
        },
      });
      await w.deliver(update({ title: 'TYPED' }, null));
      return `requests: ${String(requests)}, last callback: ${seen.at(-1) ?? '—'}`;
    },
  },
  {
    id: '4 a slow first response',
    what: "two messages, 'OLD' answered after 80 ms and 'NEW' after 5 ms",
    recorded: 'callbacks in order ["NEW","OLD"]',
    run: async (client, w) => {
      const seen: string[] = [];
      let nth = 0;
      const slowFirst: RequestHandler = async ({ data }) => {
        const mine = (nth += 1);
        await new Promise((resolve) => setTimeout(resolve, mine === 1 ? 80 : 5));
        return { json: () => Promise.resolve({ id: 1, ...data.data }) };
      };
      client.subscribe({
        callback: (d) => seen.push(String(d['title'])),
        initialData: { id: 1, title: 'INITIAL' },
        serverURL: SERVER,
        requestHandler: slowFirst,
      });
      await Promise.all([w.deliver(update({ title: 'OLD' })), w.deliver(update({ title: 'NEW' }))]);
      return `callbacks in order ${JSON.stringify(seen)}`;
    },
  },
  {
    id: '5 an error body',
    what: "a response carrying Payload's own error shape instead of a document",
    recorded: 'callback receives {"errors":[{"message":"Forbidden"}]}',
    run: async (client, w) => {
      const seen: unknown[] = [];
      client.subscribe({
        callback: (d) => seen.push(d),
        initialData: { id: 1, title: 'INITIAL' },
        serverURL: SERVER,
        requestHandler: () =>
          Promise.resolve({ json: () => Promise.resolve({ errors: [{ message: 'Forbidden' }] }) }),
      });
      await w.deliver(update({ title: 'TYPED' }));
      return `callback receives ${JSON.stringify(seen.at(-1))}`;
    },
  },
  {
    id: '6 the request fails',
    what: "a request handler that throws TypeError('Failed to fetch')",
    recorded: 'callbacks: 0, escaped as a rejection: "Failed to fetch"',
    run: async (client, w) => {
      const seen: unknown[] = [];
      let escaped: string | null = null;
      client.subscribe({
        callback: (d) => seen.push(d),
        initialData: { id: 1, title: 'INITIAL' },
        serverURL: SERVER,
        requestHandler: () => Promise.reject(new TypeError('Failed to fetch')),
      });
      try {
        await w.deliver(update({ title: 'TYPED' }));
      } catch (error) {
        escaped = error instanceof Error ? error.message : String(error);
      }
      return `callbacks: ${String(seen.length)}, escaped as a rejection: ${JSON.stringify(escaped)}`;
    },
  },
  {
    id: '7 a slug from the message',
    what: "collectionSlug '../../admin' straight out of the posted message",
    recorded: 'endpoint: "../../admin/1"',
    run: async (client, w) => {
      let endpoint = '—';
      client.subscribe({
        callback: () => {},
        initialData: { id: 1, title: 'INITIAL' },
        serverURL: SERVER,
        requestHandler: (args) => {
          endpoint = args.endpoint;
          return echo(args);
        },
      });
      await w.deliver(update({ title: 'TYPED' }, '../../admin'));
      return `endpoint: ${JSON.stringify(endpoint)}`;
    },
  },
];

/** Packs the dist-tag and returns the extracted `package/dist/index.js` plus its version. */
function unpack(workDir: string): { entry: string; version: string } {
  const tarball = execFileSync('npm', ['pack', PACKAGE, '--pack-destination', workDir], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .pop();
  if (!tarball) throw new Error('npm pack produced no tarball name');
  execFileSync('tar', ['-xzf', join(workDir, tarball), '-C', workDir]);
  const distDir = join(workDir, 'package', 'dist');
  if (!readdirSync(distDir).includes('index.js')) {
    throw new Error(`${PACKAGE} has no dist/index.js`);
  }
  // From the manifest, not the tarball name: a pre-release version carries its
  // own hyphens (`4.0.0-canary.31`), and a name split on those reads as 4.0.0.
  const manifest = JSON.parse(readFileSync(join(workDir, 'package', 'package.json'), 'utf8')) as {
    version?: string;
  };
  return { entry: join(distDir, 'index.js'), version: manifest.version ?? 'unknown' };
}

async function main(): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'upstream-findings-'));
  const globals = globalThis as { window?: unknown };
  try {
    console.log(`[upstream-findings] packing ${PACKAGE} …`);
    const { entry, version } = unpack(workDir);
    const client = (await import(pathToFileURL(entry).href)) as UpstreamClient;
    console.log(`[upstream-findings] running against @payloadcms/live-preview ${version}`);

    const changed: string[] = [];
    for (const finding of FINDINGS) {
      const w = new FakeWindow();
      globals.window = w;
      let observed: string;
      try {
        observed = await finding.run(client, w);
      } finally {
        delete globals.window;
      }
      const same = observed === finding.recorded;
      console.log(`  ${same ? '=' : '≠'} ${finding.id} — ${observed}`);
      if (!same) {
        changed.push(
          [
            finding.id,
            `      measured with: ${finding.what}`,
            `      recorded:      ${finding.recorded}`,
            `      now:           ${observed}`,
          ].join('\n'),
        );
      }
    }

    if (changed.length > 0) {
      console.error(
        `[upstream-findings] ${String(changed.length)} of ${String(FINDINGS.length)} no longer ` +
          `reproduce on ${version}:`,
      );
      for (const line of changed) console.error(`  ✗ ${line}`);
      console.error(
        '[upstream-findings] A changed observation is upstream news, not a bug here. Re-read the ' +
          'row in docs/react.md and the case in tests/unit/adapters/payload-hook-comparison.test.ts: ' +
          'a comparison the other package has outgrown is a claim, and it goes.',
      );
      process.exit(1);
    }
    console.log(
      `[upstream-findings] OK — all ${String(FINDINGS.length)} reproduce on ${version}, ` +
        'so every row of the comparison in docs/react.md still describes it.',
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error('[upstream-findings] script error:', error);
  process.exit(1);
});
