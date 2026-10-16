/**
 * Run the copied real admin with its own schema and fresh fixture database.
 * Credentials remain inside the fixture; only filtered process diagnostics leave it.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { redact, redactedStream } from './diagnostics.mjs';
const work = process.env.PLP_R6_WORK;
assert.ok(work);
const cms = resolve(work, 'cms');
const generated = spawnSync(
  process.execPath,
  [resolve(work, 'node_modules/payload/bin.js'), 'generate:importmap'],
  {
    cwd: cms,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  },
);
process.stdout.write(redact(generated.stdout));
process.stderr.write(redact(generated.stderr));
assert.equal(generated.status, 0, 'Copied admin import-map generation failed');
// The reviewed lane explicitly selects webpack. Its own regular dependency
// graph is separate from the repository and from every other version lane.
const child = spawn(
  process.execPath,
  [
    resolve(work, 'node_modules/next/dist/bin/next'),
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    process.env.PLP_R6_ADMIN_PORT,
  ],
  {
    cwd: cms,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.pipe(redactedStream()).pipe(process.stdout);
child.stderr.pipe(redactedStream()).pipe(process.stderr);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (status) => {
  process.exitCode = status ?? 1;
});
