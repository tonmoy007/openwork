import assert from "node:assert/strict"
import { test } from "node:test"
import {
  checkModelIntegrity,
  processModelSchema,
  stepsHaveClaims,
  type ProcessModel,
} from "@openwork/process-model/model"

function validModel(): ProcessModel {
  return {
    version: "1.0",
    stage: "as_is",
    steps: [
      {
        id: "step-1",
        label: "Ward Office Visit",
        detail: "Obtain widow certificate",
        actor: "Citizen",
        time: "4 days",
        cost: null,
        visits: "3",
        claim_ids: ["f1:c1"],
      },
      {
        id: "step-2",
        label: "Officer Reviews Claim",
        detail: "Review and decide",
        actor: "Officer",
        time: "15 min",
        cost: null,
        visits: null,
        claim_ids: ["f2:c1"],
      },
    ],
    lanes: [
      { id: "citizen", label: "Citizen", step_ids: ["step-1"] },
      { id: "officer", label: "Officer", step_ids: ["step-2"] },
    ],
    edges: [{ from: "step-1", to: "step-2" }],
    provenance: { draft: "heuristic-v0", sources: ["f1:c1", "f2:c1"] },
  }
}

test("valid model passes schema and integrity", () => {
  const model = validModel()
  assert.equal(processModelSchema.safeParse(model).success, true)
  assert.deepEqual(checkModelIntegrity(model), [])
  assert.deepEqual(stepsHaveClaims(model), [])
})

test("schema rejects a step without claims", () => {
  const model = validModel()
  model.steps[0].claim_ids = []
  assert.equal(processModelSchema.safeParse(model).success, false)
})

test("integrity flags duplicate ids, dangling edges, and unlaned steps", () => {
  const model = validModel()
  model.steps.push({ ...model.steps[0] })
  model.edges.push({ from: "step-1", to: "ghost" })
  model.steps.push({
    id: "step-3",
    label: "Lost Step",
    detail: "",
    actor: "Citizen",
    time: null,
    cost: null,
    visits: null,
    claim_ids: ["f1:c2"],
  })
  const issues = checkModelIntegrity(model)
  assert.ok(issues.some((issue) => issue.message.includes("duplicate step id")))
  assert.ok(issues.some((issue) => issue.message.includes('unknown step "ghost"')))
  assert.ok(issues.some((issue) => issue.message.includes("in no lane")))
})

test("stepsHaveClaims lists claimless steps", () => {
  const model = validModel()
  const loose = { ...model.steps[0], claim_ids: [] as string[] }
  assert.deepEqual(stepsHaveClaims({ ...model, steps: [loose] }), ["step-1"])
})
