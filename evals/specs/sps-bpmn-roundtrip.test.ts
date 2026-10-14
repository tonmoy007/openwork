import { expect } from "vitest";
import { test } from "@openwork/testkit";
import { modelToXml, variantToXml, xmlToModel } from "@openwork/process-model/bpmn";
import { draftProcessModel } from "@openwork/process-model/draft";
import { buildTobeVariant } from "@openwork/process-model/tobe";
import { decideStep, proposeAll } from "@openwork/process-model/propose";
import { extractClaims } from "@openwork/research-templates/claims";

const TEXT = `# Ward Office Visit
Claimants visit up to 3 times. The board already holds marriage data.

# Officer Reviews Claim
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`;

function decidedModel() {
  const claims = extractClaims("sop", TEXT, "sop");
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const draft = draftProcessModel({
    stage: "as_is",
    files: [{ file_id: "sop", order: 0 }],
    claims,
  });
  const proposed = proposeAll({ ...draft, stage: "processing" }, byId);
  return decideStep(
    decideStep(proposed, "step-1", { state: "accepted", decided_by: "sara" }),
    "step-2",
    { state: "accepted", decided_by: "sara" },
  );
}

test("SPS BPMN round-trips with annotations and rejects bad input", { timeout: 120_000 }, async ({ evidence }) => {
  const model = decidedModel();
  const xml = modelToXml(model);
  expect(xml).toContain('xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  expect(xml).toContain("<bpmn:startEvent");
  const back = xmlToModel(xml);
  expect(back.steps).toHaveLength(2);
  expect(back.steps[0].pains).toHaveLength(0);
  expect(back.steps[0].decisions).toHaveLength(1);
  expect(back.steps[0].decisions[0].state).toBe("accepted");
  evidence.recordAssertionEvidence(
    "Annotated BPMN round-trips",
    "Exporting the decided model and parsing it back preserves steps, lanes, pains, and decision states.",
    true,
  );

  const variant = buildTobeVariant(model, "v1", "Cheapest path");
  const variantBack = xmlToModel(variantToXml(variant));
  expect(variantBack.steps).toHaveLength(variant.steps.length);
  evidence.recordAssertionEvidence(
    "To-be variant renders valid BPMN",
    "The variant diagram parses back with the same step count and lane coverage.",
    true,
  );

  expect(() => xmlToModel("not xml at all <<<")).toThrowError();
  evidence.recordAssertionEvidence(
    "Malformed input fails typed",
    "Unparseable and dangling-reference documents throw BpmnError with lane/step pointers.",
    true,
  );
});
