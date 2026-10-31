---
'payload-live-preview': patch
---

`pll doctor` reports `LP0711` for an element that carries `data-payload-format`, `data-payload-type` or another attribute that means something only beside `data-payload-field`, and has no field. The runtime reads them only on a bound element, so such a typo stayed silent.
