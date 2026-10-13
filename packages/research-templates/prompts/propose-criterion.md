---
version: 1.0
inputs: [step, pains, constraints, criterion]
outputs: [proposal]
---

Propose one simplification decision for this step under the given criterion.
State the proposal, the reason in plain words, the evidence citations, and
any constraint it touches. If a constraint forbids the change, propose the
closest allowed alternative (for example a fallback route) instead of
forcing it.
