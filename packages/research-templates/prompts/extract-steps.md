---
version: 1.0
inputs: [evidence_text, evidence_refs]
outputs: [steps]
---

Extract the as-is process steps from the evidence text. Return one step per
row: label, actor, time, cost, visits. Cite the evidence file and page for
every step. Never invent a step without a citation. Flag anything ambiguous
as a gap instead of guessing.
