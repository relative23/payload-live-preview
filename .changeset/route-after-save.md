---
'payload-live-preview': minor
---

`routeStrategy: 'after-save'`, and `routeAfterSave` on `LivePreviewClient`, hold a route render until Payload reports a save. Before the save a GET shows nothing the editor typed, so a page without autosave paid one server render per unbound edit for no change. The revision reports that it waits for the save, and after the save the route renders once.
