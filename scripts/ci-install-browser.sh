#!/usr/bin/env bash
# CI only: one Playwright browser and its system packages, what `npx playwright install --with-deps <browser>` does, with a
# deadline per attempt and three attempts. On 2026-10-22 single runners fetched the WebKit and Firefox packages from the Ubuntu
# mirror at a trickle (59 of 187 packages in 20 minutes, where the other runners took 30 to 50 s for the whole step), and the
# job's own timeout cancelled the run before a test had started. On such a runner every attempt against the same mirror trickled
# (PR 154: three times 180 s), so an attempt that passes its deadline is stopped, the package state is repaired, and the next one
# replaces the runner's own mirror with another; apt itself retries and gives up on a silent connection.
#   usage: bash scripts/ci-install-browser.sh <chromium|firefox|webkit>
set -u
browser=${1:?usage: ci-install-browser.sh <chromium|firefox|webkit>}
deadline=${PLP_BROWSER_INSTALL_DEADLINE:-180}

printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' |
  sudo tee /etc/apt/apt.conf.d/80-plp-ci-retries > /dev/null

# The hosted runners read the Ubuntu archive through `mirror+file:/etc/apt/apt-mirrors.txt`, and apt spreads one download over every
# mirror in it: kept as a fallback, the slow first entry still trickled a 7.4 MB package while the others were done (PR 154). A retry
# therefore drops the runner's own mirror (the first entry) and leads with another; the rest of the list stays behind it. Without
# the file (another runner) the sources are left alone.
mirrors=${PLP_APT_MIRROR_LIST:-/etc/apt/apt-mirrors.txt}
original=$(cat "$mirrors" 2>/dev/null || true)
[ -n "$original" ] && printf 'apt mirror list of this runner:\n%s\n' "$original"
prefer() {
  [ -n "$original" ] || return 0
  { printf '%s\n' "$1"; printf '%s\n' "$original" | sed 1d | cut -f1 | grep -vxF "$1"; } | sudo tee "$mirrors" > /dev/null
  # what the stopped attempt fetched in part came from the mirror that is now gone
  sudo rm -rf /var/cache/apt/archives/partial/*
  echo "attempt $attempt leads with $1 and drops $(printf '%s\n' "$original" | head -1 | cut -f1)"
}

for attempt in 1 2 3; do
  case $attempt in
    2) prefer http://archive.ubuntu.com/ubuntu/ ;;
    3) prefer http://mirrors.edge.kernel.org/ubuntu/ ;;
  esac
  # timeout signals its whole process group, so the sudo'd apt-get below npx stops with it
  if timeout --kill-after=20 "$deadline" npx playwright install --with-deps "$browser"; then
    exit 0
  fi
  echo "::warning::playwright install --with-deps $browser: attempt $attempt failed or passed ${deadline} s"
  # an apt-get that outlived its parent would hold the dpkg lock for the next attempt
  sudo pkill -x apt-get || true
  sudo dpkg --configure -a || true
  sleep 10
done
echo "::error::playwright install --with-deps $browser did not finish in three attempts"
exit 1
