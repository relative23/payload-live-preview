---
'payload-live-preview': patch
---

`LP0412` also covers a `select` or `radio` binding that prints its value as text. Payload sends the option's value, so `Long label` became `long-value` without a word; the warning names both readings and the two ways to keep the label. A real `<select>` or radio button holds the value itself and is not reported.
