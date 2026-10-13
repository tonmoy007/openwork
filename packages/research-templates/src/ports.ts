/**
 * Port contracts for the research workspace. MIT core defines these ports
 * with local (SQLite/session) implementations; EE provides adapters with
 * identical signatures (Den marketplace, org roles, managed inference).
 * MIT code never imports `ee/`; EE depends on these interfaces.
 */

export type LocalRole = "author" | "researcher" | "reviewer"

export type WorkspaceAction =
  | "edit_template"
  | "run_project"
  | "decide"
  | "approve"
  | "export"

export interface AuthzContext {
  user_ref: string
  local_role: LocalRole
  ee_roles?: string[]
}

export interface Claim {
  claim_id: string
  file_id: string
  page: number
  section: string
  quote: string
  tags: string[]
  hash: string
}

export type EvidenceStatus =
  | "uploading"
  | "indexing"
  | "indexed"
  | "failed"

export interface EvidenceFile {
  file_id: string
  project_id: string
  name: string
  type: string
  size: number
  status: EvidenceStatus
  claims: Claim[]
}

export interface ResearchProject {
  id: string
  name: string
  description: string
  country: string
  institution: string
  template_ref: string
  knowledge_category: string
  phase: string
  created_at: string
}

export interface ProjectMember {
  project_id: string
  user_ref: string
  local_role: LocalRole
}

export type ProcessStage = "as_is" | "processing" | "to_be"

export interface ProcessSnapshot {
  id: string
  project_id: string
  stage: ProcessStage
  model_json: string
  supersedes: string | null
  created_at: string
}

export type ArtifactStatus = "queued" | "done" | "blocked"

export interface ArtifactRecord {
  artifact_id: string
  project_id: string
  run_id: string
  step_ids: string[]
  sources: string[]
  model: string
  prompt_ref: string
  prompt_version: string
  template_version: string
  status: ArtifactStatus
  output_json: string | null
  created_at: string
}

export interface AuditEvent {
  event_id: string
  project_id: string
  run_id: string
  actor: string
  action: string
  entity_refs: string[]
  detail: string
  created_at: string
}

export interface StoredTemplate {
  id: string
  doc_json: string
  created_at: string
}

export interface StoredTemplateVersion {
  template_id: string
  version: string
  doc_json: string
  doc_hash: string
  created_at: string
}

export class StoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "StoreError"
    this.code = code
  }
}

export const EE_NOT_CONFIGURED = "EE_NOT_CONFIGURED" as const
export const IMMUTABLE_SNAPSHOT = "IMMUTABLE_SNAPSHOT" as const
export const NOT_FOUND = "NOT_FOUND" as const
export const FORBIDDEN = "FORBIDDEN" as const

export interface TemplateStore {
  getTemplate(id: string, version?: string): StoredTemplateVersion | null
  listLocal(): Array<{ template_id: string; version: string }>
  saveDraft(doc_json: string): StoredTemplateVersion
  clone(id: string): StoredTemplateVersion
  publishDraft(doc_json: string): StoredTemplateVersion
  assignLocal(project_id: string, template_ref: string): void
}

export interface AccessControl {
  can(ctx: AuthzContext, action: WorkspaceAction): boolean
}

export interface RunStepInput {
  prompt_ref: string
  model_pin: string
  inputs_json: string
}

export interface InferenceRunner {
  runStep(
    project_id: string,
    run_id: string,
    input: RunStepInput,
  ): ArtifactRecord
}

export interface AuditSink {
  append(event: Omit<AuditEvent, "created_at">): AuditEvent
  list(project_id: string): AuditEvent[]
}
