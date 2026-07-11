# Benchmarks

Hot-path timings from `npm run test:bench` (vitest bench, jsdom, Node 22, 2026-07). jsdom is not a browser — read these as **relative regression signals**, not absolute browser timings. Refresh this table when touching the cache, sanitizer, or Lexical renderer.

| Hot path | ops/sec | mean |
|---|---:|---:|
| `resolveFieldValue` — 4-level nested path | 8,812,000 | 0.11 µs |
| `diffArray` — 100 items (insert + remove + moves) | 248,600 | 4.0 µs |
| `escapeHtml` — ~2 KB string | 123,200 | 8.1 µs |
| `lexicalToHtml` — 30 paragraphs with links | 1,302 | 0.77 ms |
| `sanitizeHtml` — ~2 KB mixed document | 1,035 | 0.97 ms |
| `ElementCache.buildFromRoot` — 300 bound elements | 185 | 5.4 ms |

Interpretation for a live-editing session: a keystroke triggers field
resolution (~µs), possibly a Lexical render + sanitize (~2 ms for a
sizeable rich-text field), and a scheduler flush. The dominant cost —
cache building — happens once at startup and after DOM mutations, not
per keystroke; 300 bindings build in ~5 ms. Everything on the
per-keystroke path stays comfortably below a 60 fps frame budget
(16.7 ms) even in jsdom, which is substantially slower than real
browser DOM implementations.
