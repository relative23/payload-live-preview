---
'payload-live-preview': patch
---

`revealEditedField` opens a closed `<details>` around the edited field. A closed one lays nothing out, so the scroll went nowhere and the edit stayed out of sight. The reveal keeps its rule: a section the editor closes again stays closed while they type on in the same field.
