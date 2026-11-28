/**
 * The replay store of the `signed-token` strategy against a real engine. The
 * unit tests model an atomic store with a `Set`; here the store is SQLite,
 * which Node carries, and the atomic step is the insert under a primary key.
 * Two connections to one file stand for two servers that redeem a token at
 * the same moment.
 */
import { webcrypto } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authorizePreviewRequest,
  issuePreviewToken,
  type PreviewAuthorizationRequest,
  type PreviewTokenReplayStore,
  type SignedTokenStrategy,
  type SubtleCryptoLike,
} from '@security/preview-authorization';

const crypto = webcrypto as unknown as SubtleCryptoLike;
const SITE = 'https://www.example.com';
const SECRET = 'a-secret-that-is-at-least-thirty-two-bytes-long';
const NOW = 1_800_000_000_000;
const strategy: SignedTokenStrategy = {
  type: 'signed-token',
  secret: SECRET,
  audience: SITE,
  crypto,
  now: () => NOW,
};

const request = (url: string): PreviewAuthorizationRequest => ({
  url,
  headers: { get: () => null },
});
const token = (): Promise<string> =>
  issuePreviewToken({ audience: SITE, path: '/page' }, { secret: SECRET, crypto, now: () => NOW });

let directory = '';
const connections: DatabaseSync[] = [];

/** One server's connection, and the store it would hand the strategy. */
function server(): { database: DatabaseSync; replay: PreviewTokenReplayStore } {
  const database = new DatabaseSync(join(directory, 'replay.db'));
  connections.push(database);
  database.exec(
    'PRAGMA busy_timeout = 2000; ' +
      'CREATE TABLE IF NOT EXISTS redeemed (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL) STRICT',
  );
  const insert = database.prepare('INSERT OR IGNORE INTO redeemed (id, expires_at) VALUES (?, ?)');
  return {
    database,
    replay: {
      consume: async (id, expiresAt) => {
        // Both requests have passed every check of the token before either writes.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return insert.run(id, expiresAt).changes === 1;
      },
    },
  };
}

const redeemedRows = (database: DatabaseSync): number =>
  (database.prepare('SELECT count(*) AS n FROM redeemed').get() as { n: number }).n;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'plp-replay-store-'));
});

afterEach(() => {
  for (const database of connections.splice(0)) database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('a signed token redeemed against SQLite', () => {
  it('admits exactly one of two servers that redeem it at the same moment', async () => {
    const [first, second] = [server(), server()];
    const url = `${SITE}/page?previewToken=${await token()}`;

    const outcomes = (
      await Promise.all([
        authorizePreviewRequest(request(url), { ...strategy, replay: first.replay }),
        authorizePreviewRequest(request(url), { ...strategy, replay: second.replay }),
      ])
    ).map((result) => result.outcome);

    expect(outcomes.sort()).toEqual(['authorized', 'replayed']);
    expect(redeemedRows(first.database)).toBe(1);
  });

  it('admits one of twenty, whichever server each of them reaches', async () => {
    const servers = [server(), server()];
    const url = `${SITE}/page?previewToken=${await token()}`;

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        authorizePreviewRequest(request(url), {
          ...strategy,
          replay: servers[index % 2]!.replay,
        }).then((result) => result.outcome),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === 'authorized')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'replayed')).toHaveLength(19);
  });

  it('keeps a second token apart from the first, and refuses the first when it comes again', async () => {
    const [first, second] = [server(), server()];
    const one = `${SITE}/page?previewToken=${await token()}`;
    const other = `${SITE}/page?previewToken=${await token()}`;

    const answer = async (url: string, replay: PreviewTokenReplayStore): Promise<string> =>
      (await authorizePreviewRequest(request(url), { ...strategy, replay })).outcome;

    expect(await answer(one, first.replay)).toBe('authorized');
    expect(await answer(other, second.replay)).toBe('authorized');
    expect(await answer(one, second.replay)).toBe('replayed');
    expect(redeemedRows(second.database)).toBe(2);
  });
});
