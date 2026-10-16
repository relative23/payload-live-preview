/**
 * Resolve an ESM entry with Node from the actual isolated consumer directory.
 * Resolution executes no SDK code, then returns the canonical filesystem path
 * for the caller's unchanged archive or peer ownership checks.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveConsumerImport(consumer, specifier) {
  assert.ok(isAbsolute(consumer));
  assert.equal(typeof specifier, 'string');
  assert.ok(specifier.length > 0 && specifier.length <= 256);
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      'process.stdout.write(import.meta.resolve(process.argv[1]))',
      specifier,
    ],
    {
      cwd: consumer,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    },
  );
  assert.equal(result.status, 0, 'Native ESM resolution did not succeed');
  assert.equal(result.signal, null);
  assert.ok(
    !result.error,
    'Native ESM spawn error: ' +
      JSON.stringify({
        status: result.status,
        signal: result.signal,
        errorName: result.error?.name,
        errorCode: result.error?.code,
        syscall: result.error?.syscall,
        stdoutBytes: Buffer.byteLength(result.stdout ?? ''),
        stderrBytes: Buffer.byteLength(result.stderr ?? ''),
      }),
  );
  const url = new URL(result.stdout);
  assert.equal(url.protocol, 'file:');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return realpathSync(fileURLToPath(url));
}
