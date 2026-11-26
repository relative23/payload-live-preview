# Payload version lanes

Prepare separate Linux consumers for Payload 3.90.2 and 4.0.0-beta.6.
Each consumer keeps its own archive, dependency lock, database and reports.
Use this example from the repository root with a selected package archive.

| Lane | Admin | Required Node | Native probe |
| --- | --- | --- | --- |
| `v3` | Next 16.3.4, React 19.2.8, Vue 3.5.42 | 24.0.0 | 12 lifecycle cases per surface, or 3 saved-wire cases |
| `v4` | Next 16.4.3, React 19.2.8, Vue 3.5.42 | 24.22.1 | Separate pre-release characterization |

These Node values are lane requirements, not measurements of the SDK's Node
floor. Pre-release results do not grant stable Payload support. A v4 protocol
profile needs actual wire evidence and a separate review; the 4.0.0-beta.6 corpus
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
consumers; `--surface=vue` selects Vue, and `--probe=wire` the saved-wire probe:

```bash
node "$task_lane" prepare --repo="$task_repo" --lane=v4 --surface=vue --probe=wire \
  --tarball="$task_archive" --sha256="$task_sha" --out="$task_dir/v4-wire"
```

Both lanes create fresh SQLite paths. No existing demo database is used.

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

Probe refuses an altered source, archive, installed SDK file or reviewed lock.
Existing outputs are retained; use another preparation to diagnose a failed run.

Installation is bounded to 20 minutes, compilation to 2 minutes and native tests
to 25 minutes. Each stage records its raw exit, signal, timeout and owned process
groups. Cancellation or a leftover group keeps the gate red. There are no retries.

Saved-wire probes record bounded message shapes and verify a populated saved
document with the editor's cookie and a configured Origin. Shape metadata keeps array
and string schemas distinct and retains no schema or credential values.
These scoped developmental results do not complete the release matrix or replace
production builds, version floors or native Safari and screenreader checks.
