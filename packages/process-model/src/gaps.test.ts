import assert from "node:assert/strict"
import { test } from "node:test"
import { draftProcessModel } from "@openwork/process-model/draft"
import { suggestGaps } from "@openwork/process-model/gaps"
import { extractClaims } from "@openwork/research-templates/claims"

const TEXT = `# Ward Office Visit
Claimants visit the ward office up to 3 times on average.

# Officer Reviews Claim
The officer reviews the case and decides under the Labour Welfare Act.`

test("single-source steps and unmeasured steps raise suggestions", () => {
  const claims = extractClaims("sop", TEXT, "sop")
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim]))
  const model = draftProcessModel({ stage: "as_is", files: [{ file_id: "sop", order: 0 }], claims })
  const suggestions = suggestGaps(model, byId)
  assert.ok(suggestions.some((suggestion) => suggestion.suggestion_id === "step-1-single-source"))
  assert.ok(suggestions.some((suggestion) => suggestion.suggestion_id === "step-1-no-measures"))
  assert.ok(suggestions.some((suggestion) => suggestion.suggestion_id === "corpus-single-source"))
  for (const suggestion of suggestions) {
    assert.ok(suggestion.question.length > 0)
    assert.ok(suggestion.reason.length > 0)
  }
})

test("suggestions are deterministic", () => {
  const build = () => {
    const claims = extractClaims("sop", TEXT, "sop")
    const byId = new Map(claims.map((claim) => [claim.claim_id, claim]))
    const model = draftProcessModel({ stage: "as_is", files: [{ file_id: "sop", order: 0 }], claims })
    return suggestGaps(model, byId)
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(build())),
    JSON.parse(JSON.stringify(build())),
  )
})
