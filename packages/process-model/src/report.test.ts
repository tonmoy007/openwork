import assert from "node:assert/strict"
import { test } from "node:test"
import { buildDecisionRecord, buildSimplificationReport } from "@openwork/process-model/report"

const INPUT = {
  projectName: "Welfare Grant",
  template_ref: "sps-ecrs-v1@1.0",
  snapshot_id: "snap-1",
  runStamp: "run-1",
  steps: [
    {
      n: 1,
      label: "Ward Office Visit",
      actor: "Citizen",
      decision: "accepted eliminate",
      reason: "Duplicates registry data",
      sources: ["SOP.txt p1"],
    },
  ],
  constraints: [{ statement: "Officer decision stays.", reason: "Act s.14." }],
  costs: [{ measure: "visits", before: 8, after: 2, delta: 6, pct: 75, warnings: [] }],
}

test("simplification report carries decisions, constraints, and costs", () => {
  const html = buildSimplificationReport(INPUT)
  assert.ok(html.includes("Ward Office Visit"))
  assert.ok(html.includes("Officer decision stays."))
  assert.ok(html.includes("75%"))
  assert.ok(html.includes("sps-ecrs-v1@1.0"))
  assert.ok(html.includes("snapshot snap-1"))
})

test("decision record escapes content and stamps provenance", () => {
  const html = buildDecisionRecord({
    ...INPUT,
    steps: [{ ...INPUT.steps[0], reason: "A & B <C>" }],
  })
  assert.ok(html.includes("A &amp; B &lt;C&gt;"))
  assert.ok(html.includes("run-1"))
})
