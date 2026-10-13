import assert from "node:assert/strict"
import { test } from "node:test"
import { draftProcessModel } from "@openwork/process-model/draft"
import { authorStep, decideStep, proposeAll, stepsMissingDecision } from "@openwork/process-model/propose"
import { checkModelIntegrity, processModelSchema } from "@openwork/process-model/model"
import { extractClaims } from "@openwork/research-templates/claims"
import type { Claim } from "@openwork/research-templates/ports"

const TEXT = `# Ward Office Visit
Claimants visit up to 3 times. The welfare board already holds marriage registration data.

# Bus to District Office
The district office is 4 hours by bus. Claimants make this trip at least twice.

# Officer Reviews Claim
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`

function input() {
  const claims = extractClaims("sop", TEXT, "sop")
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]))
  const model = draftProcessModel({
    stage: "as_is",
    files: [{ file_id: "sop", order: 0 }],
    claims,
  })
  return { model, byId }
}

test("heuristic proposes keep, eliminate, and defers the rest", () => {
  const { model, byId } = input()
  const proposed = proposeAll(model, byId)
  assert.equal(processModelSchema.safeParse(proposed).success, true)
  assert.deepEqual(checkModelIntegrity(proposed), [])
  const ward = proposed.steps.find((step) => step.label.includes("Ward Office"))
  const bus = proposed.steps.find((step) => step.label.includes("Bus"))
  const officer = proposed.steps.find((step) => step.label.includes("Officer"))
  assert.equal(ward?.simplification?.action, "eliminate")
  assert.equal(bus?.simplification?.action, "eliminate")
  assert.equal(officer?.simplification?.action, "keep")
  for (const step of proposed.steps) {
    if (step.simplification) assert.equal(step.simplification.state, "proposed")
  }
})

test("decide transitions and tracks revision parents", () => {
  const { model, byId } = input()
  const proposed = proposeAll(model, byId)
  const accepted = decideStep(proposed, "step-1", {
    state: "accepted",
    decided_by: "sara",
  })
  const first = accepted.steps[0].simplification
  assert.equal(first?.state, "accepted")
  assert.equal(first?.decided_by, "sara")
  assert.equal(first?.revised_from, null)

  const revised = decideStep(accepted, "step-1", {
    state: "revised",
    proposal: "Eliminate with union-office fallback.",
    decided_by: "sara",
  })
  const updated = revised.steps[0].simplification
  assert.equal(updated?.state, "revised")
  assert.equal(updated?.proposal, "Eliminate with union-office fallback.")
  assert.ok((updated?.revised_from ?? "").includes("Eliminate this step"))

  assert.deepEqual(stepsMissingDecision(revised), ["step-2", "step-3"])
  const done = decideStep(
    decideStep(revised, "step-2", { state: "rejected", decided_by: "sara" }),
    "step-3",
    { state: "accepted", decided_by: "sara" },
  )
  assert.deepEqual(stepsMissingDecision(done), [])
})

test("proposeAll never overwrites existing decisions", () => {
  const { model, byId } = input()
  const once = proposeAll(model, byId)
  const decided = decideStep(once, "step-1", { state: "accepted", decided_by: "sara" })
  const twice = proposeAll(decided, byId)
  assert.equal(twice.steps[0].simplification?.state, "accepted")
})

test("claims map carries the tags the heuristic reads", () => {
  const claims: Claim[] = extractClaims("sop", TEXT, "sop")
  const tags = new Set(claims.flatMap((claim) => claim.tags))
  assert.ok(tags.has("duplication") || tags.has("registry"))
  assert.ok(tags.has("travel"))
  assert.ok(tags.has("legal"))
})

test("authorStep creates decisions for heuristic-missed steps", () => {
  const { model, byId } = input()
  void byId
  const authored = authorStep(model, "step-1", {
    criterion_id: "simplify",
    action: "simplify",
    proposal: "Rewrite in Bengali.",
    reason: "English-only excludes claimants.",
    claim_ids: model.steps[0].claim_ids,
    state: "accepted",
    decided_by: "sara",
  })
  assert.equal(authored.steps[0].simplification?.criterion_id, "simplify")
  assert.equal(authored.steps[0].simplification?.state, "accepted")
  const repeat = authorStep(authored, "step-1", {
    criterion_id: "simplify",
    action: "simplify",
    proposal: "Other.",
    reason: "Other.",
    claim_ids: [],
    state: "accepted",
    decided_by: "sara",
  })
  assert.equal(repeat.steps[0].simplification?.proposal, "Rewrite in Bengali.")
})
