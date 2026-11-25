---
'payload-live-preview': major
---

Node 24 or newer is required: `engines.node` is `>=24.0.0` (ADR 0007, row 28). Node 20 reached its end of life on 2026-04-30, Node 22 follows on 2027-04-30, and Payload 4 asks for Node 24 itself. Nothing else changes with this row: move the build and the server to Node 24 or newer, which 2.x already runs on. A project that stays on Node 20 or 22 stays on 2.x.
