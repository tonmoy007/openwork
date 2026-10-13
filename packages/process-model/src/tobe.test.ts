import assert from "node:assert/strict"
import { test } from "node:test"
import { draftProcessModel } from "@openwork/process-model/draft"
import { buildTobeVariant } from "@openwork/process-model/tobe"
import { decideStep, proposeAll } from "@openwork/process-model/propose"
import { extractClaims } from "@openwork/research-templates/claims"

const TEXT = `# Ward Office Visit
Claimants visit up to 3 times. The board already holds marriage data.

# Bus to District Office
The district office is 4 hours by bus. Claimants make this trip twice.

# Officer Reviews Claim
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`

function decidedModel() {
  const claims = extractClaims("sop", TEXT, "sop")
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]))
  const draft = draftProcessModel({
    stage: "as_is",
    files: [{ file_id: "sop", order: 0 }],
    claims,
  })
  const proposed = proposeAll({ ...draft, stage: "processing" }, byId)
  const decided = decideStep(
    decideStep(
      decideStep(proposed, "step-1", { state: "accepted", decided_by: "sara" }),
      "step-2",
      { state: "accepted", decided_by: "sara" },
    ),
    "step-3",
    { state: "accepted", decided_by: "sara" },
  )
  return decided
}

test("to-be drops accepted eliminations and keeps the rest", () => {
  const variant = buildTobeVariant(decidedModel(), "v1", "Cheapest path")
  assert.equal(variant.steps.length, 1)
  assert.equal(variant.steps[0].label, "Officer Reviews Claim")
  assert.equal(variant.steps[0].origin, "kept")
  assert.deepEqual(variant.source_decisions, [
    "step-1:eliminated",
    "step-2:eliminated",
    "step-3:accepted",
  ])
})

test("revised steps carry revised text as changed", () => {
  const model = decidedModel()
  const revised = {
    ...model,
    steps: model.steps.map((step) =>
      step.id === "step-3"
        ? {
            ...step,
            simplification: step.simplification
              ? {
                  ...step.simplification,
                  state: "revised" as const,
                  proposal: "Decide within 5 working days.",
                  revised_from: step.simplification.proposal,
                }
              : step.simplification,
          }
        : step,
    ),
  }
  const variant = buildTobeVariant(revised, "v1", "Cheapest path")
  assert.equal(variant.steps.length, 1)
  assert.equal(variant.steps[0].origin, "changed")
  assert.equal(variant.steps[0].detail, "Decide within 5 working days.")
  assert.deepEqual(variant.source_decisions, [
    "step-1:eliminated",
    "step-2:eliminated",
    "step-3:revised",
  ])
})

test("builder refuses undecided models", () => {
  const claims = extractClaims("sop", TEXT, "sop")
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]))
  const draft = draftProcessModel({
    stage: "as_is",
    files: [{ file_id: "sop", order: 0 }],
    claims,
  })
  const proposed = proposeAll({ ...draft, stage: "processing" }, byId)
  assert.throws(() => buildTobeVariant(proposed, "v1", "x"), /no terminal decision/)
})
