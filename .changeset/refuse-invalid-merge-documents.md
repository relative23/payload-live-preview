---
'payload-live-preview': patch
---

Keep documents with an explicitly mismatched ID out of live preview. The REST merger checks collection IDs and global slugs against the dispatched target; React and Vue sessions keep their last good document on refusal and recover on the next valid response. Projected responses without identity fields remain supported, including documents with a field named `errors`. This check does not replace server authorization or validate the document schema.
