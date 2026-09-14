---
'payload-live-preview': patch
---

`pll doctor` can audit the preview 2.0 sets up by default, and `pll migrate` says what the `isPreviewRequest` rename keeps.

- The preview probe requests the page with `?preview=true`, the intent a 2.0 adapter counts (`previewSignals: ['query']`). It used to send `Sec-Fetch-Dest: iframe` alone, which a 2.0 adapter does not read as intent, so a default 2.0 deployment answered it like an ordinary visit and every audit reported LP0701. The visitor probe now drops any intent parameter the URL carried, so the two requests still differ in exactly that.
- `--header "Name: value"` (or `-H`, repeatable) sends an editor's credentials with the preview probe only: a Payload session `Cookie` or an `x-preview-token`. A preview behind `authorizePreview`, the strict 2.0 default, answers a request without them exactly like a page that never injects; LP0701 and the LP0709 about an unreadable configuration now name that reading and the option. Values never appear in the report. Programmatic callers pass `previewHeaders` to `runDoctor()`.
- After renaming `isPreviewRequest()` to `hasPreviewIntent()`, `pll migrate` notes that the new name takes the same options and, without `signals`, counts the same three signals, while the 2.0 adapters count only the query: pass `{ signals: ['query'] }` where a call should agree with them. The note does not change the exit code.
