---
'payload-live-preview': minor
---

Add `data-payload-format`, so a bound date or number can be written the way the
page writes it.

Until now a bound date was always a localised date and time, and a bound number
always the locale's plain grouping. A template that shows `17 October 2026` or
`€12.00` therefore had to leave those fields unbound — and an unbound field is
one an editor changes without seeing anything happen.

```astro
<time data-payload-field="startsAt" data-payload-format="date:long">17 October 2026</time>
<span data-payload-field="price" data-payload-format="currency:EUR">€12.00</span>
```

The vocabulary is closed — `date`, `date:short|medium|long|full`, `time`,
`datetime`, `number`, `number:0-4`, `currency:XXX`, `percent` — because anything
a page could pass beyond it would be code running inside the preview. An unknown
value reports `LP0408` once for that element and writes the value unformatted.

No relative form ("in 3 days"): choosing the unit and its rounding is policy
rather than formatting.
