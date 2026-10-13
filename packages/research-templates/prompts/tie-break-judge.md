---
version: 1.0
inputs: [step, candidate_a, candidate_b, scores]
outputs: [pick, reason]
---

Two agents scored within the tie margin for this step. Pick one and give a
two-sentence reason citing capabilities and evidence fit. Never invent new
scores; choose from the candidates given.
