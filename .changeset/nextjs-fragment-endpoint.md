---
'payload-live-preview': minor
---

Add the fragment endpoint to the Next.js adapter, and let every adapter point at
one.

Server-rendered boundaries existed only for Astro. That was never a limit of the
endpoint — its authorization, protocol, limits and registry lookup never touched
a component system — but the only export lived in `payload-live-preview/astro`,
so a Next.js project had to import the Astro entry and pass its own `render` to
get a boundary rendered. The endpoint now lives in
`@adapters/shared/fragment-endpoint`, and each adapter binds a renderer to it in
a few dozen lines.

```ts
// app/payload/fragment/route.ts
import { createFragmentEndpoint, defineFragment } from 'payload-live-preview/nextjs';
import { Hero } from '@/components/Hero';

export const POST = createFragmentEndpoint({
  authorizePreview,
  registry: {
    hero: defineFragment(Hero, ({ fields }) => ({ title: String(fields.title ?? '') })),
  },
});
```

`defineFragment()` pairs a component with the props it takes, so a renamed prop
is a type error in the registry instead of an empty boundary in the preview.
React renders through `renderToString()`; `react` and `react-dom` are optional
peers imported at the first render, so a project that registers no fragment
never loads them — as `astro` already was for the Astro binding.

The `fragments: { endpoint }` option moves from the Astro adapter's options to
the shared ones, so the Next.js, SvelteKit and Nuxt adapters accept it too. It
only names a same-origin path the runtime posts to; which framework serves that
path is the endpoint's business.

A render that throws now also logs the boundary's id and the message once per
process, outside production. The response stays a generic `500 {"error":"render"}`
— from the browser a component that throws on every request was indistinguishable
from a network fault, and nothing said which boundary it was.
