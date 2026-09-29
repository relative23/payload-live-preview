---
'payload-live-preview': patch
---

The fragment endpoint accepts `fields` nested up to 64 levels instead of 12. A bulleted list in a column's rich text inside a layout block is 13 levels deep, so the endpoint answered such pages 400 and every edit of their fragment boundaries was patched instead of rendered (`LP0801`). The ceiling still bounds the walk over a body posted before authorization. The endpoint guide now states what the 64 KiB body cap holds, about 4 500 words of rich text, and the troubleshooting table names the 413 past it (ADR 0027).
