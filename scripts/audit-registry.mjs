/**
 * Temporary exceptions must not hide a newly available compatible release.
 * Query the official registry without changing a lockfile; unexpected responses
 * and newer stable versions in the reviewed major track require triage.
 */
// @ts-check
import { spawnSync } from 'node:child_process';

/** JSON.parse discards duplicate keys, which could hide a register declaration.
 * @param {string} text
 * @returns {unknown}
 */
export function parseUniqueJson(text) {
  /** @type {unknown} */
  const value = JSON.parse(text);
  /** @type {({keys: Set<string>, key: boolean} | null)[]} */
  const stack = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]:,]/gu)) {
    const token = match[0];
    const current = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && current) current.key = true;
    else if (token.startsWith('"') && current?.key) {
      /** @type {unknown} */
      const key = JSON.parse(token);
      if (typeof key !== 'string') throw new Error('audit-gate: malformed JSON key');
      if (current.keys.has(key)) throw new Error(`audit-gate: duplicate JSON key ${key}`);
      current.keys.add(key);
      current.key = false;
    }
  }
  return value;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/iu;
/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(`audit-gate: ${message}`);
}

/** @param {unknown} versions @param {string} expected @returns {void} */
export function validateNoFixVersions(versions, expected) {
  if (!VERSION.test(expected) || expected.includes('-') || expected.includes('+')) {
    fail('invalid reviewed stable version');
  }
  if (!Array.isArray(versions) || versions.length === 0) fail('missing registry versions');
  /** @type {string[]} */
  const releases = [];
  for (const raw of versions) {
    /** @type {unknown} */
    const value = raw;
    if (
      typeof value !== 'string' ||
      !VERSION.test(value) ||
      value
        .split(/[.+-]/u)
        .slice(0, 3)
        .some((part) => !Number.isSafeInteger(Number(part)))
    ) {
      fail('unexpected registry semver');
    }
    const prerelease = (value.split('+')[0] ?? '').split('-').slice(1).join('-');
    if (
      prerelease.split('.').some((part) => part === '' || /^0\d+$/u.test(part)) &&
      prerelease !== ''
    ) {
      fail('unexpected registry semver');
    }
    const build = value.split('+')[1];
    if (build?.split('.').some((part) => part === '')) fail('unexpected registry semver');
    releases.push(value);
  }
  if (!releases.includes(expected)) fail('reviewed version missing from registry');
  const major = expected.split('.')[0];
  const stable = releases.filter(
    (value) => !(value.split('+')[0] ?? '').includes('-') && value.split('.')[0] === major,
  );
  /** @param {string} value @returns {number[]} */
  const numbers = (value) => (value.split('+')[0] ?? '').split('.').map(Number);
  /** @param {string} a @param {string} b @returns {number} */
  const compare = (a, b) => {
    const left = numbers(a);
    const right = numbers(b);
    return (
      (right[0] ?? 0) - (left[0] ?? 0) ||
      (right[1] ?? 0) - (left[1] ?? 0) ||
      (right[2] ?? 0) - (left[2] ?? 0)
    );
  };
  const latest = stable.sort(compare)[0];
  if (stable.some((value) => value !== expected && compare(value, expected) <= 0)) {
    fail('new stable version requires fresh NoFix triage');
  }
  if (latest !== expected) fail(`new stable version ${String(latest)} requires fresh NoFix triage`);
}

/** @param {string} name @param {string} version @returns {void} */
export function verifyNoFixTrack(name, version) {
  const response = spawnSync(
    'npm',
    [
      'view',
      name,
      'versions',
      '--json',
      '--registry=https://registry.npmjs.org',
      '--offline=false',
      '--prefer-online',
    ],
    {
      encoding: 'utf8',
      timeout: 15_000,
      killSignal: 'SIGKILL',
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (response.error !== undefined || response.signal !== null || response.status !== 0) {
    fail(`registry query failed for ${name}`);
  }
  /** @type {unknown} */
  let versions;
  try {
    versions = JSON.parse(response.stdout);
  } catch {
    fail(`non-JSON registry response for ${name}`);
  }
  validateNoFixVersions(versions, version);
}
