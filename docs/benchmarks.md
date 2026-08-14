# Benchmarks

Hot-path timings from `npm run test:bench -- --run` (Vitest bench, jsdom,
Node 24.18, 2026-08). jsdom is not a browser — read these as **relative
regression signals**, not absolute browser timings. Refresh this table when
touching the cache, scheduler, message bus, sanitizer, or Lexical renderer.

| Hot path                                          |   ops/sec |     mean |
| ------------------------------------------------- | --------: | -------: |
| `resolveFieldValue` — 4-level nested path         | 7,467,094 |  0.13 µs |
| `diffArray` — 100 items (insert + remove + moves) |   254,369 |   3.9 µs |
| `escapeHtml` — ~2 KB string                       |   132,718 |   7.5 µs |
| No-listener `elementUpdate` path — 300 bindings   |   768,610 |   1.3 µs |
| `lexicalToHtml` — 30 paragraphs with links        |     1,556 | 0.643 ms |
| `sanitizeHtml` — ~2 KB mixed document             |     1,169 | 0.856 ms |
| Ordered async token pipeline — 1,000 messages     |       518 | 1.931 ms |
| `ElementCache.buildFromRoot` — 300 bound elements |       216 | 4.633 ms |

Interpretation for a live-editing session: a keystroke triggers field
resolution (~µs), possibly a Lexical render + sanitize (~1.5 ms for a
sizeable rich-text field), and a scheduler flush. The dominant cost —
cache building — happens once at startup and after DOM mutations, not
per keystroke; 300 bindings build in ~4.6 ms. Dotted-path lookup validates every
segment as an own, pollution-safe property and still completes in about 0.13 µs.
Each measured representative operation on the per-keystroke path stays comfortably
below a 60 fps frame budget (16.7 ms), even in jsdom, which is substantially slower
than real browser DOM implementations. These isolated measurements do not promise a
whole-update bound for pages that render many expensive bindings in one revision.

The 1.0.4 concurrency pipeline also had two separate, profiling-only controlled comparisons
on the same maintainer host. They are not cases emitted by the current
`npm run test:bench -- --run` suite and are not pass/fail gates: an 80,000-verdict
backlog measured a 1,443 ms median with per-entry `Array.shift()` versus 5.11 ms with
amortized O(1) dequeue, while a 300-binding update with no `elementUpdate` observer
measured 0.1267 ms versus 0.00128 ms after unused DOM snapshots and Promise dispatch
were skipped. The committed suite retains the optimized 1,000-verdict and no-listener
paths as ongoing trend signals. Functional tests, rather than these wall-clock values,
assert order, reset, reentrancy, and event truth.
