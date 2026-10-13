import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { validateTemplate } from "@openwork/research-templates/validate"

const dir = dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(
  readFileSync(resolve(dir, "seed/sps-ecrs-v1.json"), "utf8"),
)

const KNOWN_PROMPTS = new Set([
  "extract-steps",
  "extract-constraints",
  "extract-pains",
  "propose-criterion",
  "gap-question",
  "tie-break-judge",
  "report-sections",
])

function clone() {
  return JSON.parse(JSON.stringify(seed))
}

test("seed sps-ecrs-v1 validates with known prompts", () => {
  const result = validateTemplate(seed, KNOWN_PROMPTS)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
})

test("rejects unknown evidence type", () => {
  const doc = clone()
  doc.knowledge_sections[0].evidence_types = ["carrier_pigeon"]
  const result = validateTemplate(doc, KNOWN_PROMPTS)
  assert.equal(result.ok, false)
  assert.ok(result.issues.length > 0)
})

test("rejects dangling agent fallback", () => {
  const doc = clone()
  doc.agents.definitions[0].fallback = "ghost-agent"
  const result = validateTemplate(doc, KNOWN_PROMPTS)
  assert.equal(result.ok, false)
  assert.ok(
    result.issues.some((issue) => issue.path.includes("fallback")),
  )
})

test("rejects formula referencing undeclared measure", () => {
  const doc = clone()
  doc.cost_model.formulas.visits_saved =
    "sum(as_is.visits) - teleport(tobe.visits)"
  const result = validateTemplate(doc, KNOWN_PROMPTS)
  assert.equal(result.ok, false)
  assert.ok(
    result.issues.some((issue) =>
      issue.path.includes("cost_model.formulas.visits_saved"),
    ),
  )
})

test("rejects formula with denied construct", () => {
  const doc = clone()
  doc.cost_model.formulas.visits_saved = "fetch(as_is.visits)"
  const result = validateTemplate(doc, KNOWN_PROMPTS)
  assert.equal(result.ok, false)
  assert.ok(
    result.issues.some((issue) => issue.message.includes("denied")),
  )
})

test("rejects missing prompt ref", () => {
  const known = new Set(KNOWN_PROMPTS)
  known.delete("gap-question")
  const result = validateTemplate(seed, known)
  assert.equal(result.ok, false)
  assert.ok(
    result.issues.some((issue) => issue.message.includes("gap-question")),
  )
})

test("rejects routing weights that do not sum to 1", () => {
  const doc = clone()
  doc.agents.routing.weights.cost = 0.5
  const result = validateTemplate(doc, KNOWN_PROMPTS)
  assert.equal(result.ok, false)
  assert.ok(
    result.issues.some((issue) => issue.path === "agents.routing.weights"),
  )
})
