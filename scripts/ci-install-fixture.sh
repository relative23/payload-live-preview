#!/usr/bin/env bash
# CI only: `npm ci` for one example fixture, then a check that every platform package its lockfile names for this runner is on
# disk, with three attempts. On 2026-10-24 (main CI run 40096362187) npm left out the SvelteKit fixture's
# `@rolldown/binding-linux-x64-gnu`, reported success with 72 instead of 73 packages, and the fixture's `svelte-kit sync || echo ''`
# swallowed the first error; the dev server then failed as a test failure. The Firefox and WebKit jobs of the same run installed all
# 73 from the same lockfile, so another `npm ci` is the repair. A failing `npm ci` is tried again only when npm calls it a network
# error: on 2026-11-02 (main CI run 41406520393) the registry reset the connection while npm unpacked `next` for
# examples/payload-backend (ECONNRESET, "network aborted"), and the job failed before a test ran. Any other failure is a real error.
#   usage: bash scripts/ci-install-fixture.sh <fixture directory>
set -u
dir=${1:?usage: ci-install-fixture.sh <fixture directory>}
log=$(mktemp)
trap 'rm -f "$log"' EXIT
exec 3>&1

for attempt in 1 2 3; do
  # npm's stderr goes to the job log and to $log, its stdout to the job log alone.
  npm ci --no-audit --no-fund --prefix "$dir" 2>&1 >&3 | tee "$log" >&2
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    grep -Eq '^npm (error|ERR!) network ' "$log" || exit 1
    echo "::warning::npm ci --prefix $dir: attempt $attempt failed on the network"
    continue
  fi
  node scripts/check-platform-packages.ts "$dir" && exit 0
  echo "::warning::npm ci --prefix $dir: attempt $attempt left out a platform package of the lockfile"
done
echo "::error::npm ci --prefix $dir did not install every package of its lockfile in three attempts"
exit 1
