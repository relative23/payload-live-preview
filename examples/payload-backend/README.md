# payload-backend — real Payload E2E fixture

A minimal, self-contained **Payload 3.x** server used to prove the live
preview runtime against a _real_ Payload admin — not a mock, not a
replayed message. It is the backend behind `tests/real-payload/` and the
two `Real Payload E2E` CI jobs.

What it is:

- **SQLite** (`@payloadcms/db-sqlite`, `file:./e2e.db`) — no external
  database, boots anywhere.
- A `homepage` **global** with `title`, `subtitle`, `body` (Lexical rich
  text) and a `tags` array — the fields the Astro preview page binds.
- **Live Preview** enabled for that global, pointing its iframe at the
  Astro preview app (`FRONTEND_URL`, default `http://localhost:4173`).
- **Auto-login** of a seeded editor (`e2e@example.com` / `test1234`) and
  an `onInit` that creates that user when it is missing and, on every boot,
  writes `title`, `subtitle` and `tags` back to their seeded values, so E2E
  runs start from known content and require no credential typing.

> ⚠️ Throwaway fixture. The secret is hard-coded and auth auto-logs-in. The
> database is not reset: `e2e.db` persists between boots, and `body` keeps
> whatever was last saved. Never deploy this.

## Run it

```bash
npm install
npm run e2e:serve    # admin at http://localhost:3001/admin
```

`e2e:serve` generates the admin import map before `next dev`; the map
(`src/app/(payload)/admin/importMap.js`) is gitignored, so `npm run dev`
alone fails on a fresh checkout until `npm run generate:importmap` has run.

Then start the Astro preview app (`examples/astro-payload`) on `:4173`,
open the homepage global, and toggle **Live Preview**.

## In CI / tests

The Playwright config (`playwright.real-payload.config.ts`) boots this
server with `npm run e2e:serve` alongside the Astro preview, then drives
the real postMessage protocol end to end. From the repo root:

```bash
npm run test:e2e:real-payload
```

CI runs it twice: against `examples/astro-payload` on `:4173` in Chromium
(`Real Payload E2E`), and with `PLP_REAL_PAYLOAD_TARGET=hybrid` against
`examples/astro-hybrid` on `:4177` in Chromium, Firefox and WebKit
(`Real Payload E2E (hybrid, …)`), where `FRONTEND_URL` points the admin's
iframe at that app.
