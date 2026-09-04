/**
 * Install the npm version this repository pins, where the running Node can.
 *
 * Every job that produces or inspects the published artifact runs on the pinned
 * Node with the pinned npm, so packaging stays reproducible. The Node matrix
 * asks a different question — does the package work on each Node the manifest
 * claims — and there the pinned npm is not the point. npm 12 needs Node 22.22
 * or newer, so on the oldest supported Node this keeps the bundled npm, which
 * is also the npm a consumer on that Node actually has.
 *
 * Plain Node with no dependencies: this runs before `npm ci`.
 *
 * Exit 0 when the pinned npm is installed, and when the running Node is too old
 * for it. Any other failure is a real one and exits non-zero.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @type {unknown} */
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
const pinned =
  typeof manifest === 'object' && manifest !== null && 'packageManager' in manifest
    ? manifest.packageManager
    : undefined;

if (typeof pinned !== 'string' || pinned.length === 0) {
  console.error('package.json declares no packageManager');
  process.exit(1);
}

const install = spawnSync('npm', ['install', '--global', pinned], { encoding: 'utf8' });
const output = `${install.stdout}${install.stderr}`;

if (install.status === 0) {
  process.stdout.write(`using ${pinned}\n`);
  process.exit(0);
}

if (output.includes('EBADENGINE')) {
  const current = spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout.trim();
  process.stdout.write(`${pinned} does not run on ${process.version}; keeping npm ${current}\n`);
  process.exit(0);
}

process.stderr.write(output);
process.exit(install.status ?? 1);
