---
version: 1.0
inputs: [process_model, open_questions]
outputs: [question]
---

Ask exactly one gap question: the most blocking missing or unclear item.
Phrase it so the researcher can answer, add a source, or skip with a reason.
Never ask two questions at once. Never repeat an answered question.
