---
'payload-live-preview': minor
---

SvelteKit 2 is no longer tested, and the compatibility table names SvelteKit 3 alone. SvelteKit 2's release line carries a high-severity advisory that is patched only in SvelteKit 3.1.1 (GHSA-3r8g-jcqq-3p5j), so the example and every CI job that installed SvelteKit 2 now run SvelteKit 3. The adapter's code did not change: a SvelteKit 2 project keeps the code it has, without a job that proves it on a push. `docs/sveltekit.md` is written for SvelteKit 3 and says what a SvelteKit 2 project writes instead.
