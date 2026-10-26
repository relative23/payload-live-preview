---
'payload-live-preview': patch
---

A route refresh shows a field no binding covers once the document is saved. The refresh asks the server again, and the server renders the saved document, so the field keeps its saved value; nothing asked again after Payload saved, and the edit stayed out of the preview until the next change in the form. When the route was last rendered from the saved document for a revision, the runtime now renders it once more when Payload reports the save (`payload-document-event`, after every save, the autosave included), and reapplies the current revision on top. A second save with nothing new in between renders nothing more.
