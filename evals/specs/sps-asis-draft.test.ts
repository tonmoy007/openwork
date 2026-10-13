import { expect } from "vitest";
import { test } from "@openwork/testkit";
import { draftProcessModel } from "@openwork/process-model/draft";
import { checkModelIntegrity, processModelSchema } from "@openwork/process-model/model";
import { tableRows } from "@openwork/process-model/rows";
import { extractClaims } from "@openwork/research-templates/claims";

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
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`;

test("SPS as-is draft builds a cited 7-step table", { timeout: 120_000 }, async ({ evidence }) => {
  const claims = extractClaims("welfare-sop", WELFARE_TEXT, "sop");
  const model = draftProcessModel({
    stage: "as_is",
    files: [{ file_id: "welfare-sop", order: 0 }],
    claims,
  });
  expect(processModelSchema.safeParse(model).success).toBe(true);
  expect(checkModelIntegrity(model)).toEqual([]);
  expect(model.steps).toHaveLength(7);
  evidence.recordAssertionEvidence(
    "Seven sections draft to seven cited steps",
    "The heuristic draft turns seven evidence sections into seven process steps, each carrying claim ids across citizen and officer lanes.",
    true,
  );

  const byId = new Map(
    claims.map((claim) => [claim.claim_id, { claim, file: "Welfare_Board_SOP_2019.txt" }]),
  );
  const rows = tableRows(model, byId);
  expect(rows).toHaveLength(7);
  expect(rows.map((row) => row.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  for (const row of rows) {
    expect(row.claim_count).toBeGreaterThanOrEqual(1);
    expect(row.sources.length).toBeGreaterThanOrEqual(1);
  }
  evidence.recordAssertionEvidence(
    "Table rows carry ordering and provenance",
    "All seven rows are numbered, typed as draft, and cite file, page, and section sources.",
    true,
  );
});
