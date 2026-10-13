/**
 * Local SQLite implementation of the research workspace ports.
 * File- or memory-backed with zero native dependencies. Follows the
 * `runtime-db.ts` pattern: node:sqlite under Node, bun:sqlite under Bun,
 * chosen at runtime behind a minimal driver interface so the server bundle
 * (built with bun) never eagerly resolves the Node-only builtin.
 * Snapshots and audit events are append-only: no update or delete API
 * exists, so immutability holds by construction.
 */
import { createHash, randomUUID } from "node:crypto"
import type {
  AccessControl,
  ArtifactRecord,
  AuditEvent,
  AuditSink,
  AuthzContext,
  Claim,
  EvidenceFile,
  EvidenceStatus,
  InferenceRunner,
  ProcessSnapshot,
  ProcessStage,
  ProjectMember,
  ResearchProject,
  RunStepInput,
  StoredTemplateVersion,
  TemplateStore,
  WorkspaceAction,
} from "@openwork/research-templates/ports"
import { EE_NOT_CONFIGURED, NOT_FOUND, StoreError } from "@openwork/research-templates/ports"
import { validateTemplate } from "@openwork/research-templates/validate"

/** Kept in consts so Bun's loader never eagerly pre-resolves Node-only builtins. */
const NODE_SQLITE_SPECIFIER = "node:sqlite"
const BUN_SQLITE_SPECIFIER = "bun:sqlite"

type SqlRow = Record<string, unknown>

interface SqlStatement {
  get(...params: unknown[]): SqlRow | undefined
  all(...params: unknown[]): SqlRow[]
  run(...params: unknown[]): { changes: number }
}

interface SqlDriver {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
}

async function loadDriver(path: string): Promise<SqlDriver> {
  if (isBun()) {
    const loaded: unknown = await import(BUN_SQLITE_SPECIFIER)
    const mod = loaded as {
      Database: new (path: string) => {
        exec(sql: string): void
        prepare(sql: string): {
          get(...params: unknown[]): SqlRow | undefined
          all(...params: unknown[]): SqlRow[]
          run(...params: unknown[]): { changes: number | bigint }
        }
        close(): void
      }
    }
    const db = new mod.Database(path)
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        const stmt = db.prepare(sql)
        return {
          get: (...params) => stmt.get(...params),
          all: (...params) => stmt.all(...params),
          run: (...params) => ({
            changes: Number(stmt.run(...params).changes),
          }),
        }
      },
      close: () => db.close(),
    }
  }
  const loaded: unknown = await import(NODE_SQLITE_SPECIFIER)
  const mod = loaded as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void
      prepare(sql: string): {
        get(...params: unknown[]): SqlRow | undefined
        all(...params: unknown[]): SqlRow[]
        run(...params: unknown[]): { changes: number | bigint }
      }
      close(): void
    }
  }
  const db = new mod.DatabaseSync(path)
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql)
      return {
        get: (...params) => stmt.get(...params),
        all: (...params) => stmt.all(...params),
        run: (...params) => ({
          changes: Number(stmt.run(...params).changes),
        }),
      }
    },
    close: () => db.close(),
  }
}

const DDL = `
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  doc_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS template_versions (
  template_id TEXT NOT NULL,
  version TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  doc_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, version)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  institution TEXT NOT NULL DEFAULT '',
  template_ref TEXT NOT NULL,
  knowledge_category TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'evidence',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  user_ref TEXT NOT NULL,
  local_role TEXT NOT NULL,
  PRIMARY KEY (project_id, user_ref)
);
CREATE TABLE IF NOT EXISTS evidence_files (
  file_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL,
  claims_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS process_models (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  model_json TEXT NOT NULL,
  supersedes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cost_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tobe_variants (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_ids_json TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_ref TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  template_version TEXT NOT NULL,
  status TEXT NOT NULL,
  output_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_refs_json TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`

function now(): string {
  return new Date().toISOString()
}

function hashDoc(doc_json: string): string {
  return createHash("sha256").update(doc_json).digest("hex")
}

function textColumn(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") {
    throw new StoreError("CORRUPT_ROW", `row column ${key} is not text`)
  }
  return value
}

function optionalTextColumn(row: SqlRow, key: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string") {
    throw new StoreError("CORRUPT_ROW", `row column ${key} is not text`)
  }
  return value
}

function intColumn(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value !== "number") {
    throw new StoreError("CORRUPT_ROW", `row column ${key} is not a number`)
  }
  return value
}

function stringListColumn(row: SqlRow, key: string): string[] {
  const parsed: unknown = JSON.parse(textColumn(row, key))
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new StoreError("CORRUPT_ROW", `row column ${key} is not a string list`)
  }
  return parsed
}

function claimListColumn(row: SqlRow, key: string): Claim[] {
  const parsed: unknown = JSON.parse(textColumn(row, key))
  if (!Array.isArray(parsed)) {
    throw new StoreError("CORRUPT_ROW", `row column ${key} is not a list`)
  }
  return parsed.map((item): Claim => {
    if (typeof item !== "object" || item === null) {
      throw new StoreError("CORRUPT_ROW", `row column ${key} holds a bad claim`)
    }
    const record = item as Record<string, unknown>
    const stringField = (field: string): string => {
      const fieldValue = record[field]
      if (typeof fieldValue !== "string") {
        throw new StoreError("CORRUPT_ROW", `claim field ${field} is not text`)
      }
      return fieldValue
    }
    const page = record.page
    if (typeof page !== "number") {
      throw new StoreError("CORRUPT_ROW", "claim field page is not a number")
    }
    const tags = record.tags
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) {
      throw new StoreError("CORRUPT_ROW", "claim field tags is not a string list")
    }
    return {
      claim_id: stringField("claim_id"),
      file_id: stringField("file_id"),
      page,
      section: stringField("section"),
      quote: stringField("quote"),
      tags,
      hash: stringField("hash"),
    }
  })
}

function evidenceStatus(value: string): EvidenceStatus {
  if (value !== "uploading" && value !== "indexing" && value !== "indexed" && value !== "failed") {
    throw new StoreError("CORRUPT_ROW", `unknown evidence status ${value}`)
  }
  return value
}

function processStage(value: string): ProcessStage {
  if (value !== "as_is" && value !== "processing" && value !== "to_be") {
    throw new StoreError("CORRUPT_ROW", `unknown process stage ${value}`)
  }
  return value
}

export interface LocalStore {
  templates: TemplateStore
  access: AccessControl
  runner: InferenceRunner
  audit: AuditSink
  listProjects(): ResearchProject[]
  createProject(input: {
    name: string
    description?: string
    country?: string
    institution?: string
    template_ref: string
    knowledge_category: string
  }): ResearchProject
  addMember(member: ProjectMember): ProjectMember
  saveEvidence(
    file: Omit<EvidenceFile, "claims"> & { claims?: EvidenceFile["claims"] },
  ): EvidenceFile
  getEvidence(project_id: string): EvidenceFile[]
  saveSnapshot(input: {
    project_id: string
    stage: ProcessSnapshot["stage"]
    model_json: string
    supersedes?: string | null
  }): ProcessSnapshot
  listSnapshots(project_id: string): ProcessSnapshot[]
  close(): void
}

const ROLE_ACTIONS: Record<ProjectMember["local_role"], WorkspaceAction[]> = {
  author: ["edit_template"],
  researcher: ["run_project", "decide", "export"],
  reviewer: ["approve", "decide", "export"],
}

export function openStore(path: string): Promise<LocalStore> {
  return loadDriver(path).then((db) => buildStore(db))
}

function buildStore(db: SqlDriver): LocalStore {
  db.exec(DDL)

  function parseTemplateDoc(doc_json: string): { id: string; version: string } {
    const result = validateTemplate(JSON.parse(doc_json))
    if (!result.ok || !result.template) {
      throw new StoreError(
        "INVALID_TEMPLATE",
        `draft failed validation: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
      )
    }
    return { id: result.template.id, version: result.template.version }
  }

  function readTemplateVersion(row: SqlRow): StoredTemplateVersion {
    return {
      template_id: textColumn(row, "template_id"),
      version: textColumn(row, "version"),
      doc_json: textColumn(row, "doc_json"),
      doc_hash: textColumn(row, "doc_hash"),
      created_at: textColumn(row, "created_at"),
    }
  }

  const templates: TemplateStore = {
    getTemplate(id, version) {
      const row =
        version === undefined
          ? db
              .prepare(
                "SELECT template_id, version, doc_json, doc_hash, created_at FROM template_versions WHERE template_id = ? ORDER BY rowid DESC LIMIT 1",
              )
              .get(id)
          : db
              .prepare(
                "SELECT template_id, version, doc_json, doc_hash, created_at FROM template_versions WHERE template_id = ? AND version = ?",
              )
              .get(id, version)
      return row === undefined ? null : readTemplateVersion(row)
    },
    listLocal() {
      return db
        .prepare(
          "SELECT template_id, version FROM template_versions ORDER BY template_id, rowid",
        )
        .all()
        .map((row) => ({
          template_id: textColumn(row, "template_id"),
          version: textColumn(row, "version"),
        }))
    },
    saveDraft(doc_json) {
      const { id, version } = parseTemplateDoc(doc_json)
      const created = now()
      db.prepare(
        "INSERT INTO templates (id, doc_json, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc_json = excluded.doc_json",
      ).run(id, doc_json, created)
      try {
        db.prepare(
          "INSERT INTO template_versions (template_id, version, doc_json, doc_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(id, version, doc_json, hashDoc(doc_json), created)
      } catch {
        throw new StoreError(
          "VERSION_EXISTS",
          `template ${id}@${version} already published`,
        )
      }
      return {
        template_id: id,
        version,
        doc_json,
        doc_hash: hashDoc(doc_json),
        created_at: created,
      }
    },
    clone(id) {
      const latest = templates.getTemplate(id)
      if (!latest) throw new StoreError(NOT_FOUND, `template ${id} not found`)
      const doc = { ...JSON.parse(latest.doc_json), id: `${id}-copy` }
      return templates.saveDraft(JSON.stringify(doc))
    },
    publishDraft(doc_json) {
      return templates.saveDraft(doc_json)
    },
    assignLocal(project_id, template_ref) {
      const result = db
        .prepare("UPDATE projects SET template_ref = ? WHERE id = ?")
        .run(template_ref, project_id)
      if (result.changes === 0) {
        throw new StoreError(NOT_FOUND, `project ${project_id} not found`)
      }
    },
  }

  const access: AccessControl = {
    can(ctx: AuthzContext, action: WorkspaceAction) {
      return ROLE_ACTIONS[ctx.local_role]?.includes(action) ?? false
    },
  }

  const audit: AuditSink = {
    append(event) {
      const record: AuditEvent = { ...event, created_at: now() }
      db.prepare(
        "INSERT INTO audit_events (event_id, project_id, run_id, actor, action, entity_refs_json, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        record.event_id,
        record.project_id,
        record.run_id,
        record.actor,
        record.action,
        JSON.stringify(record.entity_refs),
        record.detail,
        record.created_at,
      )
      return record
    },
    list(project_id) {
      return db
        .prepare(
          "SELECT event_id, project_id, run_id, actor, action, entity_refs_json, detail, created_at FROM audit_events WHERE project_id = ? ORDER BY rowid",
        )
        .all(project_id)
        .map(
          (row): AuditEvent => ({
            event_id: textColumn(row, "event_id"),
            project_id: textColumn(row, "project_id"),
            run_id: textColumn(row, "run_id"),
            actor: textColumn(row, "actor"),
            action: textColumn(row, "action"),
            entity_refs: stringListColumn(row, "entity_refs_json"),
            detail: textColumn(row, "detail"),
            created_at: textColumn(row, "created_at"),
          }),
        )
    },
  }

  const runner: InferenceRunner = {
    runStep(project_id, run_id, input: RunStepInput) {
      const record: ArtifactRecord = {
        artifact_id: randomUUID(),
        project_id,
        run_id,
        step_ids: [],
        sources: [],
        model: input.model_pin,
        prompt_ref: input.prompt_ref,
        prompt_version: "1.0",
        template_version: "sps-ecrs-v1@1.0",
        status: "queued",
        output_json: null,
        created_at: now(),
      }
      db.prepare(
        "INSERT INTO artifacts (artifact_id, project_id, run_id, step_ids_json, sources_json, model, prompt_ref, prompt_version, template_version, status, output_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        record.artifact_id,
        record.project_id,
        record.run_id,
        JSON.stringify(record.step_ids),
        JSON.stringify(record.sources),
        record.model,
        record.prompt_ref,
        record.prompt_version,
        record.template_version,
        record.status,
        record.output_json,
        record.created_at,
      )
      return record
    },
  }

  return {
    templates,
    access,
    runner,
    audit,
    listProjects() {
      return db
        .prepare(
          "SELECT id, name, description, country, institution, template_ref, knowledge_category, phase, created_at FROM projects ORDER BY rowid",
        )
        .all()
        .map(
          (row): ResearchProject => ({
            id: textColumn(row, "id"),
            name: textColumn(row, "name"),
            description: textColumn(row, "description"),
            country: textColumn(row, "country"),
            institution: textColumn(row, "institution"),
            template_ref: textColumn(row, "template_ref"),
            knowledge_category: textColumn(row, "knowledge_category"),
            phase: textColumn(row, "phase"),
            created_at: textColumn(row, "created_at"),
          }),
        )
    },
    createProject(input) {
      const project: ResearchProject = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? "",
        country: input.country ?? "",
        institution: input.institution ?? "",
        template_ref: input.template_ref,
        knowledge_category: input.knowledge_category,
        phase: "evidence",
        created_at: now(),
      }
      db.prepare(
        "INSERT INTO projects (id, name, description, country, institution, template_ref, knowledge_category, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        project.id,
        project.name,
        project.description,
        project.country,
        project.institution,
        project.template_ref,
        project.knowledge_category,
        project.phase,
        project.created_at,
      )
      return project
    },
    addMember(member) {
      db.prepare(
        "INSERT INTO project_members (project_id, user_ref, local_role) VALUES (?, ?, ?) ON CONFLICT(project_id, user_ref) DO UPDATE SET local_role = excluded.local_role",
      ).run(member.project_id, member.user_ref, member.local_role)
      return member
    },
    saveEvidence(file) {
      const record: EvidenceFile = { claims: [], ...file }
      db.prepare(
        "INSERT INTO evidence_files (file_id, project_id, name, type, size, status, claims_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET status = excluded.status, claims_json = excluded.claims_json",
      ).run(
        record.file_id,
        record.project_id,
        record.name,
        record.type,
        record.size,
        record.status,
        JSON.stringify(record.claims),
      )
      return record
    },
    getEvidence(project_id) {
      return db
        .prepare(
          "SELECT file_id, project_id, name, type, size, status, claims_json FROM evidence_files WHERE project_id = ? ORDER BY rowid",
        )
        .all(project_id)
        .map(
          (row): EvidenceFile => ({
            file_id: textColumn(row, "file_id"),
            project_id: textColumn(row, "project_id"),
            name: textColumn(row, "name"),
            type: textColumn(row, "type"),
            size: intColumn(row, "size"),
            status: evidenceStatus(textColumn(row, "status")),
            claims: claimListColumn(row, "claims_json"),
          }),
        )
    },
    saveSnapshot(input) {
      const snapshot: ProcessSnapshot = {
        id: randomUUID(),
        project_id: input.project_id,
        stage: input.stage,
        model_json: input.model_json,
        supersedes: input.supersedes ?? null,
        created_at: now(),
      }
      db.prepare(
        "INSERT INTO process_models (id, project_id, stage, model_json, supersedes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        snapshot.id,
        snapshot.project_id,
        snapshot.stage,
        snapshot.model_json,
        snapshot.supersedes,
        snapshot.created_at,
      )
      return snapshot
    },
    listSnapshots(project_id) {
      return db
        .prepare(
          "SELECT id, project_id, stage, model_json, supersedes, created_at FROM process_models WHERE project_id = ? ORDER BY rowid",
        )
        .all(project_id)
        .map(
          (row): ProcessSnapshot => ({
            id: textColumn(row, "id"),
            project_id: textColumn(row, "project_id"),
            stage: processStage(textColumn(row, "stage")),
            model_json: textColumn(row, "model_json"),
            supersedes: optionalTextColumn(row, "supersedes"),
            created_at: textColumn(row, "created_at"),
          }),
        )
    },
    close() {
      db.close()
    },
  }
}

export { EE_NOT_CONFIGURED }
