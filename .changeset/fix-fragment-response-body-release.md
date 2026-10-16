---
'payload-live-preview': patch
---

Release unread fragment response bodies after HTTP refusals, unexpected content types, excessive declared lengths or superseded requests without waiting for producer cleanup. Free body readers after completion, cancellation, size refusal or read errors. When a response arrives after its request deadline, stop before reading its body. Keep existing outcomes, limits and timeouts, and leave successfully completed responses uncancelled.
