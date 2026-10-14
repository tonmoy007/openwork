import assert from "node:assert/strict"
import { test } from "node:test"
import { SEED_TEMPLATES } from "@openwork/research-templates/seed"
import { validateTemplate } from "@openwork/research-templates/validate"

test("seed templates validate", () => {
  assert.ok(SEED_TEMPLATES.length >= 1)
  for (const seed of SEED_TEMPLATES) {
    const result = validateTemplate(JSON.parse(seed.doc_json))
    assert.equal(result.ok, true, JSON.stringify(result.issues))
    assert.equal(result.template?.id, seed.id)
  }
})
