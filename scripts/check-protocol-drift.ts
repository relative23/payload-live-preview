/**
 * Protocol-drift watchdog.
 *
 * This library mirrors Payload's live-preview postMessage protocol by
 * hand (there is deliberately no `payload` dependency), so nothing
 * breaks loudly when Payload changes the wire format. This script
 * downloads the latest `@payloadcms/live-preview` from npm and asserts
 * the invariants we depend on:
 *
 *   1. The ready handshake still posts `{ type: 'payload-live-preview',
 *      ready: true }` to parent/opener.
 *   2. The merge endpoint still uses `X-Payload-HTTP-Method-Override:
 *      GET` with `{ data, depth, flattenLocales, locale }`.
 *   3. The subscription handler still matches messages on
 *      `type === 'payload-live-preview'`.
 *
 * Run weekly in CI (`protocol-watch.yml`). A failure means Payload
 * changed the protocol and `src/types/payload-protocol.ts` +
 * `src/core/*` need a compatibility review.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKAGE = process.env['PROTOCOL_WATCH_PACKAGE'] ?? '@payloadcms/live-preview@latest';

interface Invariant {
  readonly file: RegExp;
  readonly mustContain: readonly string[];
  readonly reason: string;
}

const INVARIANTS: readonly Invariant[] = [
  {
    file: /ready\.js$/,
    mustContain: ["'payload-live-preview'", 'ready: true'],
    reason: 'ready handshake message shape',
  },
  {
    file: /mergeData\.js$/,
    mustContain: ['X-Payload-HTTP-Method-Override', 'flattenLocales', 'depth'],
    reason: 'REST merge request shape (DataMerger replicates this)',
  },
  {
    // 3.72 kept the discriminator inline in handleMessage.js; 3.86
    // extracted it into isLivePreviewEvent.js. Accept either home.
    file: /(handleMessage|isLivePreviewEvent)\.js$/,
    mustContain: ["'payload-live-preview'"],
    reason: 'incoming update discriminator',
  },
];

function main(): void {
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
    const files = collectFiles(distDir);
    const failures: string[] = [];

    for (const invariant of INVARIANTS) {
      const matches = files.filter((f) => invariant.file.test(f));
      if (matches.length === 0) {
        failures.push(`missing file matching ${String(invariant.file)} (${invariant.reason})`);
        continue;
      }
      // Pass when the union of matching files carries every needle —
      // Payload moves code between modules across minor versions.
      const combined = matches.map((f) => readFileSync(f, 'utf8')).join('\n');
      for (const needle of invariant.mustContain) {
        if (!combined.includes(needle)) {
          failures.push(
            `${matches.join(', ')}: no longer contains ${JSON.stringify(needle)} (${invariant.reason})`,
          );
        }
      }
    }

    if (failures.length > 0) {
      console.error('[protocol-watch] PROTOCOL DRIFT DETECTED:');
      for (const failure of failures) console.error(`  - ${failure}`);
      console.error(
        '[protocol-watch] Review src/types/payload-protocol.ts, src/core/message-bus.ts, src/core/data-merger.ts against the new package.',
      );
      process.exit(1);
    }
    console.log(`[protocol-watch] OK — ${PACKAGE} still matches our protocol assumptions.`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

main();
