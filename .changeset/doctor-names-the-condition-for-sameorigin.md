---
'payload-live-preview': patch
---

`pll doctor` no longer reports `X-Frame-Options: SAMEORIGIN` as an error when it
was not told which origin embeds the preview. The header refuses a frame from
another origin; where the admin and the site share one, the preview runs, and
calling that an error made the audit fail a deployment with nothing wrong with
it.

**If you gate CI on the exit code, read this:** an anonymous probe of a page
serving `SAMEORIGIN` — `pll doctor <url>` with no `--admin` — now ends with
exit 0 and a warning, where it ended with exit 2 and an error. Nothing else
moves: with `--admin` a shared origin was already silent and a foreign one is
still an error, and `DENY` stays an error in every case, because no origin
makes it harmless. The warning names the condition and asks for `--admin` so
the next run can decide.
