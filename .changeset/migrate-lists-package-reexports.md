---
'payload-live-preview': patch
---

`pll migrate` now lists a re-export straight from the package. `export { isPreviewRequest } from 'payload-live-preview'` was neither rewritten nor listed, so a module that passed the 1.x name on kept it without a word; it is now listed as `file:line` with the two ways out, and an aliased re-export (`export { isPreviewRequest as guard } from …`) is rewritten on the package side and keeps its own name. `export { fetchPreviewDocument } from 'payload-live-preview'` is listed too. A script that `move-fetch-preview-helpers` holds back no longer reports that its calls "were rewritten"; the advice about a key with no home in 2.0 stays.
