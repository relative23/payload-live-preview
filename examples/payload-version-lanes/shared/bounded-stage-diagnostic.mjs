/**
 * Reuse the reviewed bounded stage contract for an independent lifecycle queue.
 * Every child result is retained, and only positively identified owned process
 * groups are stopped. A cancellation or leftover descendant keeps the gate red.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { diagnostic, redactedStream } from './diagnostics.mjs';
import { closeBoundarySnapshot } from './close-boundary.mjs';
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function processStat(pid) {
  try {
    const text = readFileSync('/proc/' + pid + '/stat', 'utf8');
    const values = text
      .slice(text.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/u);
    return {
      pid: Number(pid),
      parent: Number(values[1]),
      group: Number(values[2]),
      start: values[19],
      state: values[0],
    };
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) return undefined;
    throw error;
  }
}
function processTable() {
  return readdirSync('/proc')
    .filter((name) => /^[0-9]+$/u.test(name))
    .map(processStat)
    .filter(Boolean);
}
function groupAlive(group) {
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
export function boundedStages(context) {
  const { root, queue, archive, record, checkBeforeStage, atomicWrite, assertNotCancelled } =
    context;
  return async function stage(name, file, argv, env, timeoutMs, captureStdout = false) {
    checkBeforeStage();
    const log = resolve(queue, name + '.log');
    const exitPath = resolve(queue, name + '.exit');
    const descriptor = openSync(log, 'wx', 0o600);
    record({ stage: name, status: 'running', log, timeoutMs, archiveSHA256: archive.sha256 });
    const groups = new Map();
    const ownGroup = processStat(process.pid).group;
    const chunks = [];
    const filters = [];
    const ownershipErrors = new Set();
    let capturedBytes = 0;
    let raw;
    let launchError;
    let stopReason;
    let ioError;
    let closed = false;
    let childCloseSnapshot;
    let closeBoundaryError;
    let stopAt;
    const child = spawn(process.execPath, [file, ...argv], {
      cwd: root,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    function collectGroups() {
      const table = processTable();
      const descendants = new Set(child.pid ? [child.pid] : []);
      let changed = true;
      while (changed) {
        changed = false;
        for (const member of table)
          if (descendants.has(member.parent) && !descendants.has(member.pid)) {
            descendants.add(member.pid);
            changed = true;
          }
      }
      for (const member of table.filter((item) => descendants.has(item.pid))) {
        assert.ok(
          member.group > 0 && member.group !== ownGroup,
          'Child escaped into the coordinator group',
        );
        if (!groups.has(member.group) || groups.get(member.group).closed)
          groups.set(member.group, { group: member.group, members: new Map(), closed: false });
        groups.get(member.group).members.set(member.pid, member.start);
      }
      for (const group of groups.values()) if (!groupAlive(group.group)) group.closed = true;
    }
    function ownedAlive(group) {
      if (group.closed || !groupAlive(group.group)) return false;
      assert.ok(
        [...group.members].some(([pid, start]) => {
          const current = processStat(pid);
          return current && current.start === start && current.group === group.group;
        }),
        'Live group lost its positive process identity; cleanup refused: ' + group.group,
      );
      return true;
    }
    function send(signal) {
      collectGroups();
      for (const group of aliveGroups()) {
        try {
          process.kill(-group.group, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') ownershipErrors.add(diagnostic(error));
        }
      }
    }
    function aliveGroups() {
      return [...groups.values()].filter((group) => {
        try {
          return ownedAlive(group);
        } catch (error) {
          ownershipErrors.add(diagnostic(error));
          return false;
        }
      });
    }
    function requestStop(reason) {
      stopReason ??= reason;
      stopAt ??= Date.now();
      try {
        send('SIGTERM');
      } catch (error) {
        ioError ??= diagnostic(error);
      }
    }
    context.setActiveStop(requestStop);
    const writeLog = (chunk) => {
      try {
        writeSync(descriptor, chunk);
      } catch (error) {
        ioError ??= diagnostic(error);
        requestStop('log-write-error');
      }
    };
    for (const [stream, isStdout] of [
      [child.stdout, true],
      [child.stderr, false],
    ]) {
      if (!stream) continue;
      if (captureStdout && isStdout)
        stream.on('data', (chunk) => {
          capturedBytes += chunk.length;
          if (capturedBytes > 1_048_576) requestStop('stdout-exceeds-bound');
          else chunks.push(chunk);
        });
      const filtered = redactedStream();
      filters.push({ stream, filtered });
      filtered.on('data', writeLog);
      filtered.on('error', (error) => {
        ioError ??= diagnostic(error);
        requestStop('diagnostic-stream-error');
      });
      stream.pipe(filtered);
    }
    const closePromise = new Promise((done) => {
      child.once('error', (error) => {
        launchError = diagnostic(error);
        requestStop('spawn-error');
      });
      child.once('close', (code, signal) => {
        closed = true;
        raw = { code, signal };
        try {
          collectGroups();
          childCloseSnapshot = closeBoundarySnapshot(
            groups,
            processTable(),
            groupAlive,
            new Date().toISOString(),
            raw,
          );
        } catch (error) {
          closeBoundaryError = diagnostic(error);
          ioError ??= closeBoundaryError;
          requestStop('close-boundary-observation-error');
        }
        done();
      });
    });
    const started = Date.now();
    let collectorError;
    try {
      // Track detached browser/server groups while their ancestry is observable.
      // Only positively identified descendants can ever be stopped by this queue.
      while (!closed) {
        assertNotCancelled();
        try {
          collectGroups();
        } catch (error) {
          collectorError = diagnostic(error);
          requestStop('ownership-observation-error');
        }
        if (!stopReason && Date.now() - started >= timeoutMs) requestStop('timeout');
        if (stopAt && Date.now() - stopAt >= 10_000) {
          try {
            send('SIGKILL');
          } catch (error) {
            collectorError ??= diagnostic(error);
          }
        }
        if (stopAt && Date.now() - stopAt >= 14_000) break;
        await Promise.race([closePromise, pause(500)]);
      }
    } catch (error) {
      collectorError ??= diagnostic(error);
      requestStop(context.cancellation() ? 'cancellation' : 'stage-exception');
    }
    let cleanupError;
    try {
      collectGroups();
      const live = aliveGroups();
      if (live.length) {
        // A successful leader with live descendants is a failed harness outcome,
        // even when cleanup subsequently stops them. No following gate starts.
        requestStop(stopReason ?? 'live-descendants-after-close');
        while (Date.now() - stopAt < 10_000 && aliveGroups().length > 0) await pause(100);
        if (aliveGroups().length > 0) send('SIGKILL');
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline && aliveGroups().length > 0) await pause(100);
        assert.equal(aliveGroups().length, 0, 'Owned process groups remain after bounded cleanup');
      }
      if (!closed) await Promise.race([closePromise, pause(250)]);
    } catch (error) {
      cleanupError = diagnostic(error);
    } finally {
      context.setActiveStop(undefined);
      for (const { stream, filtered } of filters) {
        stream.unpipe(filtered);
        filtered.removeAllListeners('data');
        filtered.destroy();
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (!closed) child.unref();
      closeSync(descriptor);
    }
    const groupResults = [...groups.values()].map((group) => {
      let closed = group.closed;
      try {
        closed ||= !groupAlive(group.group);
      } catch (error) {
        ownershipErrors.add(diagnostic(error));
      }
      return {
        group: group.group,
        observedMembers: [...group.members].map(([pid, start]) => ({ pid, start })),
        closed,
      };
    });
    if (ownershipErrors.size) cleanupError ??= [...ownershipErrors].join('\n').slice(0, 6000);
    const gateExit = context.cancellation()
      ? context.cancellation() === 'SIGTERM'
        ? 143
        : 130
      : stopReason === 'timeout'
        ? 124
        : launchError || ioError || collectorError || cleanupError || stopReason || !closed
          ? 1
          : (raw.code ?? 1);
    const result = {
      stage: name,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      executable: process.execPath,
      argv: [file, ...argv],
      archiveSHA256: archive.sha256,
      rawExit: raw ?? { code: null, signal: null },
      childCloseObserved: closed,
      gateExit,
      stopReason: stopReason ?? null,
      cancellation: context.cancellation() ?? null,
      launchError,
      ioError,
      collectorError,
      cleanupError,
      closeBoundaryError,
      childCloseSnapshot,
      log,
      ownedGroups: groupResults,
    };
    atomicWrite(resolve(queue, name + '.result.json'), result);
    writeFileSync(exitPath, String(gateExit) + '\n', { flag: 'wx', mode: 0o600 });
    assert.equal(
      gateExit,
      0,
      name + ' did not pass; its first result is preserved and no stage is repeated',
    );
    checkBeforeStage();
    return captureStdout ? Buffer.concat(chunks).toString('utf8') : undefined;
  };
}
