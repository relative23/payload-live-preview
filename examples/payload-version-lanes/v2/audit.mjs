/**
 * Inspect only this run's execution artifacts for leaked fixture credentials.
 * The private run file, installed packages and Mongo data remain private inputs;
 * findings name an artifact and category without reproducing its secret value.
 */
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import diagnostics from './template/diagnostics.cjs';
import { readRunSettings } from './identity.mjs';

// An artifact is opened once and then judged, read and rewritten through that descriptor, so a
// path swapped for a link or another file while the audit runs cannot redirect the read or the
// redaction. O_NOFOLLOW refuses a link; O_NONBLOCK keeps a FIFO from stalling the open.
const READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const WRITE = constants.O_WRONLY | constants.O_NOFOLLOW;
// What opening a link or a socket answers with, by platform.
const NOT_REGULAR = new Set(['ELOOP', 'EMLINK', 'ENXIO']);

function openArtifact(path) {
  try {
    return openSync(path, READ);
  } catch (error) {
    if (NOT_REGULAR.has(error.code)) return undefined;
    throw error;
  }
}

function redactInPlace(path, relative, read, sanitized) {
  const fd = openSync(path, WRITE);
  try {
    const now = fstatSync(fd);
    if (now.dev !== read.dev || now.ino !== read.ino)
      throw new Error('Execution artifact changed during the audit: ' + relative);
    ftruncateSync(fd);
    writeFileSync(fd, sanitized);
  } finally {
    closeSync(fd);
  }
}

export function auditRun(run, settings) {
  const redact = diagnostics.redactor(settings);
  const findings = [];
  let checkedFiles = 0;
  function check(path, relative) {
    const fd = openArtifact(path);
    try {
      const info = fd === undefined ? undefined : fstatSync(fd);
      if (!info?.isFile()) {
        findings.push({ file: relative, reason: 'non-regular execution artifact' });
        return;
      }
      if (info.size > 32 * 1024 * 1024) {
        findings.push({ file: relative, reason: 'execution artifact exceeds audit bound' });
        return;
      }
      checkedFiles++;
      const content = readFileSync(fd, 'utf8');
      const sanitized = redact(content);
      if (sanitized !== content) {
        findings.push({ file: relative, reason: 'private credential or token found and redacted' });
        redactInPlace(path, relative, info, sanitized);
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  function artifacts(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) artifacts(path, relative + '/');
      else check(path, relative);
    }
  }
  for (const entry of readdirSync(run, { withFileTypes: true })) {
    if (['run.json', 'app', 'mongo-data', 'credential-audit.json'].includes(entry.name)) continue;
    if (entry.name === 'browser-artifacts' && entry.isDirectory())
      artifacts(join(run, entry.name), entry.name + '/');
    else if (!entry.isDirectory()) check(join(run, entry.name), entry.name);
  }
  return {
    checkedAt: new Date().toISOString(),
    state: findings.length ? 'failed-private-data-redacted' : 'clean-execution-artifacts',
    checkedFiles,
    findings,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const { run, settings } = readRunSettings(here, process.env.PLP_P2_RUN_FILE);
  const result = auditRun(run, settings);
  writeFileSync(join(run, 'credential-audit.json'), JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
  if (result.findings.length) process.exitCode = 1;
}
