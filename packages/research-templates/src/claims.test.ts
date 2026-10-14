import assert from "node:assert/strict"
import { test } from "node:test"
import { bpmnTaskClaims, extractClaims } from "@openwork/research-templates/claims"
import { evaluateEvidenceGate } from "@openwork/research-templates/gates"
import type { EvidenceFile } from "@openwork/research-templates/ports"

const WELFARE_FILES = [
  {
    name: "Welfare_Board_SOP_2019.pdf",
    text: `# Widow Certificate
Claimants visit the ward office up to 3 times on average. Offices have no published schedule and closures are undocumented.

# Processing Time
Average time to obtain the certificate is 4 days. The welfare board already holds marriage registration data.`,
  },
  {
    name: "Labour_Welfare_Act_1965_amended.pdf",
    text: `# Section 14 Decision
The officer reviews the case and decides within the 90-day payment clause. A named officer must sign off under the Labour Welfare Act.

# Civil Registration
The hospital death report and the union certificate establish the same legal fact under the Civil Registration Act 2004.`,
  },
  {
    name: "Grant_ApplicationForm_WB-12.pdf",
    text: `# Form WB-12
The 12-page form is in English only. All interviewed claimants paid 300 to 500 taka for help filling it.

# Internal Fields
Pages 5 to 12 are internal routing fields. Only pages 1 to 4 are legally required.`,
  },
  {
    name: "Citizen_Interviews_6_Claimants.docx",
    text: `# The Bus Trip
The district office is 4 hours by bus. Claimants make this trip at least twice because the first submission was rejected for a missing document.

# Rejection
No checklist is provided at any point. Claimants learn requirements only at the counter.`,
  },
  {
    name: "District_Welfare_Office_Process_Map.bpmn",
    text: `<definitions><process><task>Ward Office Visit</task><task>Union Parishad Death Cert</task><task>Officer Reviews Claim</task></process></definitions>`,
  },
]

test("every welfare fixture file yields claims", () => {
  for (const [index, file] of WELFARE_FILES.entries()) {
    const claims = extractClaims(`file-${index}`, file.text, "test")
    assert.ok(claims.length >= 1, `${file.name} yielded no claims`)
    for (const claim of claims) {
      assert.ok(claim.quote.length > 0 && claim.quote.length <= 280)
      assert.ok(claim.page >= 1)
      assert.ok(claim.tags.includes("evidence"))
      assert.equal(claim.hash.length, 16)
    }
  }
})

test("extraction is deterministic and tags legal and cost content", () => {
  const first = extractClaims("f1", WELFARE_FILES[1].text, "law")
  const second = extractClaims("f1", WELFARE_FILES[1].text, "law")
  assert.deepEqual(
    JSON.parse(JSON.stringify(first)),
    JSON.parse(JSON.stringify(second)),
  )
  assert.ok(first.some((claim) => claim.tags.includes("legal")))
  const form = extractClaims("f3", WELFARE_FILES[2].text, "form")
  assert.ok(form.some((claim) => claim.tags.includes("cost")))
})

test("empty text yields no claims, short text yields one", () => {
  assert.deepEqual(extractClaims("e1", "   \n  ", "test"), [])
  const claims = extractClaims("e2", "Ward office visit takes days.", "test")
  assert.equal(claims.length, 1)
  assert.equal(claims[0].page, 1)
})

test("bpmn task labels become citable claims", () => {
  const claims = bpmnTaskClaims("f9", ["Ward Office Visit", "Union Parishad"])
  assert.equal(claims.length, 2)
  assert.equal(claims[0].claim_id, "f9:bpmn-1")
  assert.ok(claims[0].tags.includes("bpmn"))
  assert.ok(claims[1].quote.includes("Union Parishad"))
})

test("evidence gate opens only when all files are indexed with claims", () => {
  const ready: EvidenceFile[] = WELFARE_FILES.map((file, index) => ({
    file_id: `file-${index}`,
    project_id: "p",
    name: file.name,
    type: "test",
    size: file.text.length,
    status: "indexed",
    claims: extractClaims(`file-${index}`, file.text, "test"),
    kb_id: null,
    source_url: null,
    retrieved_at: null,
    source_base64: null,
  }))
  const open = evaluateEvidenceGate(ready)
  assert.equal(open.ready, true)
  assert.equal(open.indexed_count, 5)
  assert.ok(open.reasons[0].includes("5 of 5"))

  const pending = ready.map((file, index) =>
    index === 0 ? { ...file, status: "uploading" as const } : file,
  )
  const blocked = evaluateEvidenceGate(pending)
  assert.equal(blocked.ready, false)
  assert.ok(blocked.reasons[0].includes("Welfare_Board_SOP_2019.pdf"))
  assert.ok(!blocked.reasons[0].includes("G0"))

  assert.equal(evaluateEvidenceGate([]).ready, false)
})
