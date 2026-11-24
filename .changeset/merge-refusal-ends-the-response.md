---
'payload-live-preview': patch
---

A merge request that the Payload server answers with an HTTP error is now aborted. Until now the runtime reported the status and left the response's body unread and open; the request for a Payload 2 relation already aborted in that case. The outcome is unchanged: the merge is `unavailable` and the status is logged.
