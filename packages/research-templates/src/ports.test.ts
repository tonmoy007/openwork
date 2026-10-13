import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { openStore } from "@openwork/research-templates/adapters/local-sqlite"
import {
  eeAccessControl,
  eeAuditSink,
  eeInferenceRunner,
  eeTemplateMarketplace,
} from "@openwork/research-templates/adapters/ee-stub"
import {
  EE_NOT_CONFIGURED,
  NOT_FOUND,
} from "@openwork/research-templates/ports"
import type {
  Claim,
  EvidenceFile,
} from "@openwork/research-templates/ports"

const dir = dirname(fileURLToPath(import.meta.url))
const seedJson = readFileSync(resolve(dir, "seed/sps-ecrs-v1.json"), "utf8")

function claim(file_id: string, page: number, quote: string): Claim {
  return {
    claim_id: randomUUID(),
    file_id,
    page,
    section: "test",
    quote,
    tags: ["test"],
    hash: "test-hash",
  }
}

test("templates round-trip with versions and clone", async () => {
  const store = await openStore(":memory:")
  try {
    const saved = store.templates.saveDraft(seedJson)
    assert.equal(saved.template_id, "sps-ecrs-v1")
    assert.equal(saved.version, "1.0")

    const latest = store.templates.getTemplate("sps-ecrs-v1")
    assert.ok(latest)
    assert.equal(latest.doc_hash, saved.doc_hash)

    const pinned = store.templates.getTemplate("sps-ecrs-v1", "1.0")
    assert.equal(pinned?.version, "1.0")

    assert.deepEqual(JSON.parse(JSON.stringify(store.templates.listLocal())), [
      { template_id: "sps-ecrs-v1", version: "1.0" },
    ])

    const copy = store.templates.clone("sps-ecrs-v1")
    assert.equal(copy.template_id, "sps-ecrs-v1-copy")

    assert.throws(() => store.templates.clone("missing"), (error: unknown) => {
      return (
        error instanceof Error &&
        "code" in error &&
        error.code === NOT_FOUND
      )
    })
  } finally {
    store.close()
  }
})

test("projects, members, and template assignment round-trip", async () => {
  const store = await openStore(":memory:")
  try {
    store.templates.saveDraft(seedJson)
    const project = store.createProject({
      name: "Welfare Grant",
      description: "Family of a deceased worker",
      country: "Bangladesh",
      institution: "Department of Labour",
      template_ref: "sps-ecrs-v1@1.0",
      knowledge_category: "service-evidence",
    })
    assert.equal(project.phase, "evidence")

    store.addMember({
      project_id: project.id,
      user_ref: "sara",
      local_role: "researcher",
    })
    store.templates.assignLocal(project.id, "sps-ecrs-v1@1.0")
    assert.ok(
      store.listProjects().some((listed) => listed.id === project.id),
    )

    assert.throws(
      () => store.templates.assignLocal("missing-project", "sps-ecrs-v1@1.0"),
      (error: unknown) => {
        return (
          error instanceof Error &&
          "code" in error &&
          error.code === NOT_FOUND
        )
      },
    )
  } finally {
    store.close()
  }
})

test("evidence carries non-empty claims per file", async () => {
  const store = await openStore(":memory:")
  try {
    const project = store.createProject({
      name: "Welfare Grant",
      template_ref: "sps-ecrs-v1@1.0",
      knowledge_category: "service-evidence",
    })
    const files = [
      "Welfare_Board_SOP_2019.pdf",
      "Labour_Welfare_Act_1965_amended.pdf",
      "Grant_ApplicationForm_WB-12.pdf",
      "Citizen_Interviews_6_Claimants.docx",
      "District_Welfare_Office_Process_Map.bpmn",
    ]
    for (const [index, name] of files.entries()) {
      const file_id = randomUUID()
      store.saveEvidence({
        file_id,
        project_id: project.id,
        name,
        type: "test",
        size: 1000 + index,
        status: "indexed",
        claims: [claim(file_id, index + 1, `evidence quote ${index + 1}`)],
      })
    }
    const stored: EvidenceFile[] = store.getEvidence(project.id)
    assert.equal(stored.length, 5)
    for (const file of stored) {
      assert.ok(
        file.claims.length >= 1,
        `evidence ${file.name} has no claims`,
      )
    }
  } finally {
    store.close()
  }
})

test("access matrix follows local roles", async () => {
  const store = await openStore(":memory:")
  try {
    assert.equal(
      store.access.can(
        { user_ref: "u", local_role: "author" },
        "edit_template",
      ),
      true,
    )
    assert.equal(
      store.access.can({ user_ref: "u", local_role: "author" }, "approve"),
      false,
    )
    assert.equal(
      store.access.can(
        { user_ref: "u", local_role: "researcher" },
        "run_project",
      ),
      true,
    )
    assert.equal(
      store.access.can({ user_ref: "u", local_role: "researcher" }, "decide"),
      true,
    )
    assert.equal(
      store.access.can({ user_ref: "u", local_role: "researcher" }, "approve"),
      false,
    )
    assert.equal(
      store.access.can({ user_ref: "u", local_role: "reviewer" }, "approve"),
      true,
    )
    assert.equal(
      store.access.can(
        { user_ref: "u", local_role: "reviewer" },
        "edit_template",
      ),
      false,
    )
  } finally {
    store.close()
  }
})

test("project lookup, phase moves, and latest snapshots", async () => {
  const store = await openStore(":memory:")
  try {
    assert.equal(store.getProject("missing"), null)
    const project = store.createProject({
      name: "Welfare Grant",
      template_ref: "sps-ecrs-v1@1.0",
      knowledge_category: "service-evidence",
    })
    assert.equal(store.getProject(project.id)?.phase, "evidence")
    assert.equal(store.latestSnapshot(project.id, "as_is"), null)
    store.setProjectPhase(project.id, "processing")
    assert.equal(store.getProject(project.id)?.phase, "processing")

    const first = store.saveSnapshot({
      project_id: project.id,
      stage: "as_is",
      model_json: JSON.stringify({ steps: ["ward"] }),
    })
    const second = store.saveSnapshot({
      project_id: project.id,
      stage: "as_is",
      model_json: JSON.stringify({ steps: ["ward", "union"] }),
      supersedes: first.id,
    })
    assert.equal(store.latestSnapshot(project.id, "as_is")?.id, second.id)
    assert.equal(store.latestSnapshot(project.id, "to_be"), null)
    assert.throws(() => store.setProjectPhase("missing", "processing"), (error: unknown) => {
      return error instanceof Error && "code" in error && error.code === NOT_FOUND
    })
  } finally {
    store.close()
  }
})

test("snapshots are append-only and supersede", async () => {
  const store = await openStore(":memory:")
  try {
    const project = store.createProject({
      name: "Welfare Grant",
      template_ref: "sps-ecrs-v1@1.0",
      knowledge_category: "service-evidence",
    })
    const first = store.saveSnapshot({
      project_id: project.id,
      stage: "as_is",
      model_json: JSON.stringify({ steps: ["ward"] }),
    })
    const second = store.saveSnapshot({
      project_id: project.id,
      stage: "as_is",
      model_json: JSON.stringify({ steps: ["ward", "union"] }),
      supersedes: first.id,
    })
    assert.equal(second.supersedes, first.id)
    const listed = store.listSnapshots(project.id)
    assert.equal(listed.length, 2)
    assert.equal(
      listed[0].model_json,
      JSON.stringify({ steps: ["ward"] }),
      "confirmed snapshot must never mutate",
    )
  } finally {
    store.close()
  }
})

test("audit log appends in order and runner queues artifacts", async () => {
  const store = await openStore(":memory:")
  try {
    const project = store.createProject({
      name: "Welfare Grant",
      template_ref: "sps-ecrs-v1@1.0",
      knowledge_category: "service-evidence",
    })
    const run_id = randomUUID()
    store.audit.append({
      event_id: randomUUID(),
      project_id: project.id,
      run_id,
      actor: "sara",
      action: "evidence.indexed",
      entity_refs: [],
      detail: "5 files indexed",
    })
    store.audit.append({
      event_id: randomUUID(),
      project_id: project.id,
      run_id,
      actor: "sara",
      action: "asis.confirmed",
      entity_refs: [],
      detail: "as-is confirmed",
    })
    const events = store.audit.list(project.id)
    assert.deepEqual(
      events.map((event) => event.action),
      ["evidence.indexed", "asis.confirmed"],
    )

    const artifact = store.runner.runStep(project.id, run_id, {
      prompt_ref: "extract-steps",
      model_pin: "default",
      inputs_json: "{}",
    })
    assert.equal(artifact.status, "queued")
    assert.equal(artifact.run_id, run_id)
  } finally {
    store.close()
  }
})

test("EE stubs throw EE_NOT_CONFIGURED with local fallback copy", async () => {
  for (const call of [
    () => eeTemplateMarketplace.listLocal(),
    () => eeAccessControl.can({ user_ref: "u", local_role: "researcher" }, "decide"),
    () =>
      eeInferenceRunner.runStep("p", "r", {
        prompt_ref: "x",
        model_pin: "y",
        inputs_json: "{}",
      }),
    () => eeAuditSink.list("p"),
  ]) {
    assert.throws(call, (error: unknown) => {
      return (
        error instanceof Error &&
        "code" in error &&
        error.code === EE_NOT_CONFIGURED &&
        error.message.includes("stays local")
      )
    })
  }
})

test("constraints persist in order", async () => {
  const store = await openStore(":memory:")
  try {
    const project = store.createProject({
      name: "Welfare Grant",
      template_ref: "sps-ecrs-v1@1.0",
      knowledge_category: "service-evidence",
    })
    assert.deepEqual(store.listConstraints(project.id), [])
    store.saveConstraint({
      project_id: project.id,
      statement: "The officer decision stays.",
      reason: "Labour Welfare Act s.14 names the decider.",
      claim_ids: ["f2:c1"],
    })
    store.saveConstraint({
      project_id: project.id,
      statement: "Bengali form stays available.",
      reason: "Claimants read Bengali.",
      claim_ids: [],
    })
    const listed = store.listConstraints(project.id)
    assert.equal(listed.length, 2)
    assert.equal(listed[0].statement, "The officer decision stays.")
    assert.deepEqual(listed[1].claim_ids, [])
  } finally {
    store.close()
  }
})
