---
'payload-live-preview': minor
---

`pll doctor --header-env <var>` adds a header to the preview request from the environment variable `<var>`, which holds the whole `Name: value` line; repeat it for more. With `--header`, the shell puts the value into the doctor's command line, which every user of a Linux host can read in `/proc/<pid>/cmdline` while the doctor runs. The environment, `/proc/<pid>/environ`, is readable by the doctor's owner and root only. An unset variable, or a value that is not `Name: value`, is a usage error, and the value is never printed.
