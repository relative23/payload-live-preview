---
'payload-live-preview': patch
---

Fragment endpoints now enforce `limits.bodyBytes` against the bytes consumed from the request stream, even when `Content-Length` is missing or too small. Oversized bodies stop being retained or parsed at the boundary, stalled reads use the existing `timeoutMs`, and invalid limit values fail during endpoint setup.

On SvelteKit, the endpoint discards the remainder under that same deadline instead of cancelling the Node request bridge, allowing the server to return its 413 without buffering or parsing the discarded bytes.
