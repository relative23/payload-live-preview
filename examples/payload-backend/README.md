# payload-backend — real Payload E2E fixture

A minimal, self-contained **Payload 3.x** server used to prove the live
preview runtime against a *real* Payload admin — not a mock, not a
replayed message. It is the backend behind `tests/real-payload/` and the
`Real Payload E2E` CI job.

What it is:

- **SQLite** (`@payloadcms/db-sqlite`, `file:./e2e.db`) — no external
  database, boots anywhere.
- A `homepage` **global** with `title`, `subtitle`, `body` (Lexical rich
  text) and a `tags` array — the fields the Astro preview page binds.
- **Live Preview** enabled for that global, pointing its iframe at the
  Astro preview app (`FRONTEND_URL`, default `http://localhost:4173`).
- **Auto-login** of a seeded editor (`e2e@example.com` / `test1234`) and
  an `onInit` that reseeds the homepage on every boot, so E2E runs are
  deterministic and require no credential typing.

> ⚠️ Throwaway fixture. The secret is hard-coded, auth auto-logs-in, and
> the database is reset on boot. Never deploy this.

## Run it

```bash
npm install
npm run dev          # admin at http://localhost:3001/admin
```

Then start the Astro preview app (`examples/astro-payload`) on `:4173`,
open the homepage global, and toggle **Live Preview**.

## In CI / tests

The Playwright config (`playwright.real-payload.config.ts`) boots this
server with `npm run e2e:serve` (which regenerates the admin import map
first, since it is gitignored) alongside the Astro preview, then drives
the real postMessage protocol end to end. From the repo root:

```bash
npm run test:e2e:real-payload
```
