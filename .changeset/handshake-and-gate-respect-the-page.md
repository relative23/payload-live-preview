---
'payload-live-preview': patch
---

The `ready` handshake no longer guesses localhost ports where the browser names the frame's parent. With localhost matching on (development), it went to 24 localhost origins besides the configured ones, and each wrong one is a console error in the admin ("Unable to post message to …"). Where `location.ancestorOrigins` names the parent (Chromium, WebKit), the handshake goes to the configured origins and to that parent if it is a localhost origin; Firefox, which names none, keeps the ports. On a page above `visibilityGateThreshold`, an empty-field anchor (`data-payload-boundary`, `PreviewBoundary`) that is hidden or has no size is written at once: the gate held the write until the anchor scrolled into view, which a hidden element never does, so a field that was empty or emptied and typed again stayed away. LP0203 no longer names the page metadata of a join field (`events.hasNextPage`), which is not a field of the edited document.
