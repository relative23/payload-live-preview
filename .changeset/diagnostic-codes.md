---
'payload-live-preview': minor
---

Give every diagnostic a stable code. Prose gets reworded; a code does not, so a log filter, an alert rule, or a bug report that names `LP0301` keeps meaning the same thing after the sentence around it is rewritten — and a code is greppable in a way a sentence fragment is not.

Fourteen codes cover what the runtime reports today, grouped by the question they answer: configuration and origin trust (`LP01xx`), bindings and markup (`LP02xx`), scheduling (`LP03xx`), rendering (`LP04xx`), messages (`LP05xx`), and consumer callbacks (`LP06xx`). Every warning now prints its code, and the `error` event carries `code` alongside the existing `context` — branch on `code`, read `context` for the human-readable origin. `DIAGNOSTIC_CODES` is exported so consumers can name a code instead of copying a literal.

A test holds the registry against the source tree in both directions: no code is emitted that the registry does not define, and no registry entry exists that nothing reports. `LP0604` is reserved rather than assigned, because a throwing token validator is deliberately treated as a rejection and reported as `LP0502` — there is nothing distinct to report yet, and the number stays reserved rather than being handed to something else.
