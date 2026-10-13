---
version: 1.0
inputs: [evidence_text, evidence_refs, pain_dimensions]
outputs: [pains]
---

Find pain points per process step along the template's pain dimensions
(delay, cost, trips, duplication, legal basis, exclusion, language access,
rework). Each pain needs: step, dimension, one-sentence finding, severity,
and citation. Duplication across sources collapses to one pain with merged
sources.
