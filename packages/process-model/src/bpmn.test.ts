import assert from "node:assert/strict"
import { test } from "node:test"
import { BpmnError, modelToXml, SPS_NAMESPACE, variantToXml, xmlToModel } from "@openwork/process-model/bpmn"
import { draftProcessModel } from "@openwork/process-model/draft"
import { decideStep, proposeAll } from "@openwork/process-model/propose"
import { buildTobeVariant } from "@openwork/process-model/tobe"
import { extractClaims } from "@openwork/research-templates/claims"

const TEXT = `# Ward Office Visit
Claimants visit up to 3 times. The board already holds marriage data.

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
  const withPain = {
    ...proposed,
    steps: proposed.steps.map((step, index) =>
      index === 0
        ? {
            ...step,
            pains: [
              {
                pain_id: "pain-1",
                dimension: "trips",
                finding: "Three visits on average",
                severity: "high" as const,
                claim_ids: step.claim_ids,
              },
            ],
          }
        : step,
    ),
  }
  return decideStep(
    decideStep(withPain, "step-1", { state: "accepted", decided_by: "sara" }),
    "step-2",
    { state: "accepted", decided_by: "sara" },
  )
}

test("export is strict BPMN 2.0 with sps annotations", () => {
  const xml = modelToXml(decidedModel())
  assert.ok(xml.includes('xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"'))
  assert.ok(xml.includes(`xmlns:sps="${SPS_NAMESPACE}"`))
  assert.ok(xml.includes("<bpmn:laneSet>"))
  assert.ok(xml.includes("<bpmn:startEvent"))
  assert.ok(xml.includes("<bpmn:endEvent"))
  assert.ok(xml.includes("<bpmn:sequenceFlow"))
  assert.ok(xml.includes("<sps:pain"))
  assert.ok(xml.includes("<sps:decision"))
})

test("exported XML parses back with pains and decisions", () => {
  const model = decidedModel()
  const imported = xmlToModel(modelToXml(model))
  assert.equal(imported.steps.length, 2)
  assert.equal(imported.lanes.length, 1)
  assert.equal(imported.edges.length, 1)
  const first = imported.steps[0]
  assert.equal(first.pains.length, 1)
  assert.equal(first.pains[0].dimension, "trips")
  assert.deepEqual(first.pains[0].claim_ids, model.steps[0].claim_ids)
  assert.equal(first.decisions.length, 1)
  assert.equal(first.decisions[0].state, "accepted")
})

test("plain BPMN without sps imports as painless steps", () => {
  const plain = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="p" isExecutable="false">
    <bpmn:laneSet>
      <bpmn:lane id="citizen" name="Citizen">
        <bpmn:flowNodeRef>step-1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="step-1" name="Ward Office Visit" />
  </bpmn:process>
</bpmn:definitions>`
  const imported = xmlToModel(plain)
  assert.equal(imported.steps.length, 1)
  assert.equal(imported.steps[0].label, "Ward Office Visit")
  assert.deepEqual(imported.steps[0].pains, [])
  assert.deepEqual(imported.edges, [])
})

test("unknown sps extensions survive as named", () => {
  const xml = modelToXml(decidedModel()).replace(
    "</bpmn:extensionElements>",
    '<sps:cost measure="visits" before="8" after="2" /></bpmn:extensionElements>',
  )
  const imported = xmlToModel(xml)
  assert.ok(imported.steps[0].spsUnknown.includes("sps:cost"))
})

test("variant renders lanes, tasks, and flows without decisions", () => {
  const claims = extractClaims("sop", TEXT, "sop")
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]))
  const draft = draftProcessModel({ stage: "as_is", files: [{ file_id: "sop", order: 0 }], claims })
  const proposed = proposeAll({ ...draft, stage: "processing" }, byId)
  const decided = decideStep(
    decideStep(proposed, "step-1", { state: "accepted", decided_by: "sara" }),
    "step-2",
    { state: "accepted", decided_by: "sara" },
  )
  const variant = buildTobeVariant(decided, "v1", "Cheapest path")
  const xml = variantToXml(variant)
  assert.ok(xml.includes('id="sps-tobe-process"'))
  assert.ok(xml.includes("<bpmn:laneSet>"))
  const imported = xmlToModel(xml)
  assert.equal(imported.steps.length, variant.steps.length)
  assert.ok(imported.lanes.length >= 1)
})

test("malformed input fails with lane/step pointers", () => {
  assert.throws(() => xmlToModel("not xml at all <<<"), BpmnError)
  assert.throws(
    () =>
      xmlToModel(`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="p">
        <bpmn:laneSet><bpmn:lane id="l" name="L"><bpmn:flowNodeRef>ghost</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
        <bpmn:task id="step-1" name="S" />
      </bpmn:process></bpmn:definitions>`),
    (error: unknown) => error instanceof BpmnError && error.pointer.includes("lane"),
  )
  assert.throws(
    () =>
      xmlToModel(`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="p">
        <bpmn:laneSet><bpmn:lane id="l" name="L"><bpmn:flowNodeRef>step-1</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
        <bpmn:task id="step-1" name="S" />
        <bpmn:sequenceFlow id="f1" sourceRef="step-1" />
      </bpmn:process></bpmn:definitions>`),
    (error: unknown) => error instanceof BpmnError && error.pointer.includes("flow"),
  )
})
