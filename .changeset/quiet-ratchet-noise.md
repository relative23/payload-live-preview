---
'payload-live-preview': patch
---

Stop the release-critical mutation gate from failing on measurement noise. The baseline was compared exactly, so a single mutant that survives on one machine and dies on another moved the second decimal and turned scheduling luck into a red release. The policy can now declare how many flipped mutants count as noise; drift inside that band is reported for diagnosis and no longer fails the run, while a drop below the band is still a regression and a gain above it still demands a ratchet. Policies that declare no band keep comparing exactly.
