import assert from "node:assert/strict"
import { test } from "node:test"
import { draftProcessModel } from "@openwork/process-model/draft"
import { checkModelIntegrity, processModelSchema } from "@openwork/process-model/model"
import { tableRows } from "@openwork/process-model/rows"
import { extractClaims } from "@openwork/research-templates/claims"
import type { Claim } from "@openwork/research-templates/ports"

// Seven sections mirroring the welfare as-is journey: each becomes one step.
const WELFARE_TEXT = `# Ward Office Visit
Claimants visit the ward office up to 3 times on average. Offices have no published schedule.

# Union Parishad Death Certificate
The hospital issues a death report the same day. A separate 3-hour round trip is required regardless.

# Factory HR Wage Certificate
The HR officer was on leave causing a 6-day delay. Informal workers have no HR to contact.

# Fill Form WB-12
The 12-page form is in English only. Claimants pay 300 to 500 taka for help.

# Bus to District Office
The district office is 4 hours by bus. Claimants make this trip at least twice.

# Submission Rejected
First rejection for a missing document, then for the wrong format. No checklist is provided.

# Officer Reviews Claim
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`

function welfareClaims(): { claims: Claim[]; files: Array<{ file_id: string; order: number }> } {
  const claims = extractClaims("welfare-sop", WELFARE_TEXT, "sop")
  return { claims, files: [{ file_id: "welfare-sop", order: 0 }] }
}

test("seven sections draft to seven cited steps", () => {
  const { claims, files } = welfareClaims()
  const model = draftProcessModel({ stage: "as_is", files, claims })
  assert.equal(processModelSchema.safeParse(model).success, true)
  assert.deepEqual(checkModelIntegrity(model), [])
  assert.equal(model.steps.length, 7)
  assert.equal(model.provenance.draft, "heuristic-v0")
  for (const step of model.steps) {
    assert.ok(step.claim_ids.length >= 1, `${step.id} has no claims`)
  }
  const labels = model.steps.map((step) => step.label)
  assert.ok(labels.some((label) => label.includes("Ward Office Visit")))
  assert.ok(labels.some((label) => label.includes("Officer Reviews Claim")))
})

test("actors split across citizen and officer lanes", () => {
  const { claims, files } = welfareClaims()
  const model = draftProcessModel({ stage: "as_is", files, claims })
  const officer = model.steps.find((step) => step.label.includes("Officer Reviews Claim"))
  assert.equal(officer?.actor, "Officer")
  assert.ok(model.lanes.some((lane) => lane.id === "officer"))
  assert.ok(model.lanes.some((lane) => lane.id === "citizen"))
  assert.equal(model.edges.length, 6)
  assert.equal(model.edges[0].from, "step-1")
})

test("drafting is deterministic", () => {
  const input = { stage: "as_is" as const, ...welfareClaims() }
  const first = draftProcessModel(input)
  const second = draftProcessModel({ stage: "as_is" as const, ...welfareClaims() })
  assert.deepEqual(
    JSON.parse(JSON.stringify(first)),
    JSON.parse(JSON.stringify(second)),
  )
})

test("table rows carry ordering, nulls, and provenance", () => {
  const { claims, files } = welfareClaims()
  const model = draftProcessModel({ stage: "as_is", files, claims })
  const byId = new Map(
    claims.map((claim) => [claim.claim_id, { claim, file: "Welfare_Board_SOP_2019.txt" }]),
  )
  const rows = tableRows(model, byId)
  assert.equal(rows.length, 7)
  assert.deepEqual(
    rows.map((row) => row.n),
    [1, 2, 3, 4, 5, 6, 7],
  )
  for (const row of rows) {
    assert.equal(row.type, "draft")
    assert.ok(row.claim_count >= 1)
    assert.ok(row.sources.length >= 1)
    assert.equal(row.sources[0].file, "Welfare_Board_SOP_2019.txt")
    assert.ok(row.sources[0].page >= 1)
  }
  assert.equal(rows[0].time, null)
})
