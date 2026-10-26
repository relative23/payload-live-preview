/**
 * Keep Payload 2, stable 3 and current 4 pre-release testing independently repeatable.
 * Prepare/discovery are offline and light. Installs and native probes require
 * explicit coordinator resource release, exact archives and reviewed own locks.
 */
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { listLanes, discoverLane } from './readiness.mjs';
import { prepareLane } from './prepare-lane.mjs';
import { runLane } from './run-lane.mjs';
import { diagnostic } from './shared/diagnostics.mjs';

const action = process.argv[2];
const options = {};
const permitted = {
  list: ['repo'],
  prepare: ['repo', 'lane', 'tarball', 'sha256', 'out', 'surface', 'probe', 'variant'],
  discover: ['repo', 'prepared'],
  install: ['repo', 'prepared', 'resources-released'],
  probe: ['repo', 'prepared', 'lock-sha256', 'resources-released'],
};
try {
  assert.ok(permitted[action], 'Use list, prepare, discover, install or probe');
  for (const token of process.argv.slice(3)) {
    const match = /^--([a-z][a-z0-9-]*)(?:=(.+))?$/u.exec(token);
    assert.ok(match && permitted[action].includes(match[1]), 'Unknown lane argument');
    assert.ok(!Object.hasOwn(options, match[1]), 'Repeated lane argument');
    assert.ok(match[2] !== undefined || match[1] === 'resources-released', 'Use --name=value');
    options[match[1]] = match[2] ?? true;
  }
  assert.ok(options.repo, '--repo selects the repository and its read-only tooling explicitly');
  realpathSync(options.repo);
  let result;
  if (action === 'list') result = listLanes();
  else if (action === 'prepare') result = prepareLane(options);
  else if (action === 'discover') result = discoverLane(options);
  else result = await runLane(action, options);
  console.log(JSON.stringify(result, null, 2));
  if (result.gateExit) process.exitCode = result.gateExit;
} catch (error) {
  console.error(diagnostic(error));
  process.exitCode = 1;
}
