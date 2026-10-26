# Payload version lanes

Prepare separate Linux consumers for Payload 2.32.3, 3.90.2 and 4.0.0-beta.4.
Each consumer keeps its own archive, dependency lock, database and reports.
Use this example from the repository root with a selected package archive.

| Lane | Admin | Required Node | Native probe |
| --- | --- | --- | --- |
| `v2` | Express/Webpack, React 18.3.1, pinned Mongo | 20.19.0 | 24 DOM/session cases, or per React or Vue surface 9 lifecycle, 21 guard or 24 population cases |
| `v3` | Next 16.3.4, React 19.2.8, Vue 3.5.42 | 20.19.0 | 12 lifecycle cases per surface, or 3 saved-wire cases |
| `v4` | Next 16.4.3, React 19.2.8, Vue 3.5.42 | 24.22.1 | Separate pre-release characterization |

These Node values are lane requirements, not measurements of the SDK's Node
floor. Pre-release results do not grant stable Payload support. A v4 protocol
profile needs actual wire evidence and a separate review; the 4.0.0-beta.4 corpus
in `tests/fixtures/wire-corpus` is that evidence for this version, and the review
is still open. An API change can leave this lane red.

## Prepare and list

`list`, `prepare` and `discover` do not install dependencies or start servers,
databases or browsers. Discovery uses the repository's Playwright 1.62.1 tooling.
The source manifest includes the official v3/v4 registry receipts and their hashes.

```bash
task_repo="$(pwd -P)"
task_lane="$task_repo/examples/payload-version-lanes/lane.mjs"
task_archive=/absolute/path/to/payload-live-preview.tgz
task_sha="$(sha256sum "$task_archive" | cut -d ' ' -f1)"
task_dir="$(mktemp -d)"
task_out="$task_dir/v3-react"

node "$task_lane" list --repo="$task_repo"
node "$task_lane" prepare --repo="$task_repo" --lane=v3 --surface=react \
  --tarball="$task_archive" --sha256="$task_sha" --out="$task_out"
node "$task_lane" discover --repo="$task_repo" --prepared="$task_out/prepared.json"
```

Use a new output for each preparation. React and Vue probes use separate
consumers; `--surface=vue` selects Vue. The v2 consumer retains its own CSRF
variants and does not use the current v3 demo; its React and Vue pages are
`v2/native`, not the v3 `frontend`. A v2 React or Vue cell runs one
probe: `--probe=lifecycle`, the default, `--probe=guards` or `--probe=population`:

```bash
node "$task_lane" prepare --repo="$task_repo" --lane=v2 --variant=frontend-only \
  --tarball="$task_archive" --sha256="$task_sha" --out="$task_dir/v2-dom"
node "$task_lane" prepare --repo="$task_repo" --lane=v2 --surface=react --probe=population \
  --variant=server-url --tarball="$task_archive" --sha256="$task_sha" --out="$task_dir/v2-react"
node "$task_lane" prepare --repo="$task_repo" --lane=v4 --surface=vue --probe=wire \
  --tarball="$task_archive" --sha256="$task_sha" --out="$task_dir/v4-wire"
```

`--variant=server-url` selects the second v2 CSRF configuration. v2 requires
the exact Mongo image named in `lanes.json` to be present locally; the runner
does not pull it. Its container is capped at 2 GiB, memory and swap, runs as the
calling user and removes itself when it stops. v3/v4 create fresh SQLite paths. No existing demo database is used.
The titles of each v2 probe are listed in `lanes.json`; every case count comes from them.

## Install and probe

Run native work only after the coordinator releases the machine's resources.
`--resources-released` records that explicit decision. npm 12.0.2 installs the
exact direct versions with strict peers and the declared script allowlist.
Required peers must resolve inside the consumer. There is no force or peer bypass.

```bash
node "$task_lane" install --repo="$task_repo" --prepared="$task_out/prepared.json" \
  --resources-released
```

Review the retained dependency lock and `install.json` before supplying the
lock hash to the probe. For the v3 consumer above:

```bash
task_lock_sha="$(sha256sum "$task_out/app/package-lock.json" | cut -d ' ' -f1)"
node "$task_lane" probe --repo="$task_repo" --prepared="$task_out/prepared.json" \
  --lock-sha256="$task_lock_sha" --resources-released
```

The v2 app path is recorded in `prepared.json`. Its lock lives in that app,
inside the new isolated harness run. Probe refuses an altered source, archive,
installed SDK file or reviewed lock. Existing outputs are retained; use another
preparation to diagnose a failed run.

Installation is bounded to 20 minutes, compilation to 2 minutes and native tests
to 25 minutes. Each stage records its raw exit, signal, timeout and owned process
groups. Cancellation or a leftover group keeps the gate red. There are no retries.

The v2 lifecycle probe runs three journeys with the installed React hook or Vue
composable against the real admin. The first replaces the hook's owner while a
collection read is held, and the replacement aborts that read. The second changes the
document by navigation, and the third reloads the preview frame. Payload 2.32.3 sends
the field schema with the first message to a window and again only when the window
type changes, so an owner started later gets updates without one. The probe requires
that owner to start from its own seed and to refuse the update without a collection
read; a restarted admin page then populates again. The aborted read settles after the
new owner has started, and the probe shows that this commits nothing. The read is
aborted there; the guards probe below lets a genuine answer arrive after the abort. The
bundles are development builds and the engines run on Linux.

The v2 guards probe holds the same hooks to seven more cases. A late answer: a real
read is held, its owner is replaced, and only then is the genuine answer released to a
consumer whose fetch ignores the abort; the replacement already holds a state of its own,
and the old owner commits and paints nothing while the new one starts no read. Senders:
recorded admin messages are sent again from a window of the admin's origin that is not
the admin and from a foreign origin, which the default source policy refuses, and again
with `eventSourcePolicy: 'any'`, where the origin check alone refuses an origin nobody
listed; a second listed origin is taken after the first, so a hook does not lock to the
first origin. Receiver: the admin names a second frame as the receiver of a running
session, once with a read in flight; the new session starts from the seed, the old window
gets no read, and a recorded message acts once on the new one. Session: Payload's logout
route ends the session in the middle of a preview; the next update is unavailable and
its error names the HTTP status, which is 403 on Payload 2.32.3, the last good document
stays, and a sign-in through the form in a second page brings the preview back. No case
saves anything. The guards run development builds on Linux engines; they do not cover a
token that expires by time, a production build or Payload 3.

The v2 population probe types into the real admin form, picks a relationship and
checks the messages the admin sent, the credentialed collection reads and the painted
tree. Saved-wire probes record bounded message shapes and verify a populated saved
document with the editor's cookie and a configured Origin. Shape metadata keeps array
and string schemas distinct and retains no schema or credential values.
These scoped developmental results do not complete the release matrix or replace
production builds, version floors or native Safari and screenreader checks.
