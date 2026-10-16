---
'payload-live-preview': patch
---

Give each trailing merge timer its own request owner while preserving the burst's shared result promise. Ignore obsolete callbacks, cancel only handles acquired by revoked owners, and revoke the merge window before teardown so cancellation cannot overwrite a successor.
