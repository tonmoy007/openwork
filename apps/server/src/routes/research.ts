import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { evaluateConfirmGate } from "@openwork/process-model/gates";
import { draftProcessModel } from "@openwork/process-model/draft";
import { checkModelIntegrity, processModelSchema } from "@openwork/process-model/model";
import { authorStep, decideStep, proposeAll, stepsMissingDecision } from "@openwork/process-model/propose";
import { extractClaims } from "@openwork/research-templates/claims";
import { evaluateEvidenceGate } from "@openwork/research-templates/gates";
import { openStore, type LocalStore } from "@openwork/research-templates/adapters/local-sqlite";
import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";
import { addRoute, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

interface RegisterResearchRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  ensureWritable: (config: ServerConfig) => void;
}

// P2 hardening: gate these routes with requireFeature("researchWorkspace")
// once Den org context is available to openwork-server. P0 runs local-first
// on localhost with client-token auth, same trust level as /workspace routes;
// Den marketplace/assign (the EE surface) is flag-gated via /admin rollout.
const stores = new Map<string, LocalStore>();

function dbPathFor(config: ServerConfig): string {
  if (process.env.OPENWORK_RESEARCH_DB) return process.env.OPENWORK_RESEARCH_DB;
  if (config.configPath) return resolve(dirname(config.configPath), "research.sqlite");
  return resolve(process.cwd(), ".openwork-research.sqlite");
}

async function storeFor(config: ServerConfig): Promise<LocalStore> {
  const path = dbPathFor(config);
  const existing = stores.get(path);
  if (existing) return existing;
  const store = await openStore(path);
  stores.set(path, store);
  return store;
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const MAX_EVIDENCE_TEXT_BYTES = 5_000_000;

export function registerResearchRoutes(options: RegisterResearchRoutesOptions): void {
  const { routes, config, jsonResponse, readJsonBody, ensureWritable } = options;

  addRoute(routes, "GET", "/research/projects", "client", async () => {
    ensureWritable(config);
    const store = await storeFor(config);
    return jsonResponse({ projects: store.listProjects() });
  });

  addRoute(routes, "POST", "/research/projects", "client", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const template_ref = typeof body.template_ref === "string" ? body.template_ref : "";
    const knowledge_category =
      typeof body.knowledge_category === "string" ? body.knowledge_category : "";
    if (!name || !template_ref || !knowledge_category) {
      throw new ApiError(422, "invalid_project", "name, template_ref, and knowledge_category are required", {});
    }
    const store = await storeFor(config);
    const project = store.createProject({
      name,
      description: optionalText(body.description),
      country: optionalText(body.country),
      institution: optionalText(body.institution),
      template_ref,
      knowledge_category,
    });
    store.addMember({
      project_id: project.id,
      user_ref: ctx.actor?.clientId ?? "local",
      local_role: "researcher",
    });
    return jsonResponse({ project }, 201);
  });

  addRoute(routes, "GET", "/research/projects/:id/evidence", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    const files = store.getEvidence(ctx.params.id);
    return jsonResponse({ files, gate: evaluateEvidenceGate(files) });
  });

  addRoute(routes, "POST", "/research/projects/:id/evidence", "client", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = typeof body.type === "string" ? body.type : "sop";
    const text = typeof body.text === "string" ? body.text : "";
    if (!name || !text) {
      throw new ApiError(422, "invalid_evidence", "name and text are required", {});
    }
    if (Buffer.byteLength(text, "utf8") > MAX_EVIDENCE_TEXT_BYTES) {
      throw new ApiError(413, "evidence_too_large", "Evidence text exceeds 5 MB", {});
    }
    const store = await storeFor(config);
    const file_id = randomUUID();
    const claims = extractClaims(file_id, text, type);
    const file = store.saveEvidence({
      file_id,
      project_id: ctx.params.id,
      name,
      type,
      size: Buffer.byteLength(text, "utf8"),
      status: "indexed",
      claims,
    });
    return jsonResponse(
      { file, gate: evaluateEvidenceGate(store.getEvidence(ctx.params.id)) },
      201,
    );
  });

  addRoute(routes, "GET", "/research/projects/:id/gates", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    const files = store.getEvidence(ctx.params.id);
    return jsonResponse({ evidence: evaluateEvidenceGate(files) });
  });

  function requireProject(store: LocalStore, id: string) {
    const project = store.getProject(id);
    if (!project) {
      throw new ApiError(404, "project_not_found", "Research project not found", { id });
    }
    return project;
  }

  function readModel(store: LocalStore, project_id: string) {
    const snapshot = store.latestSnapshot(project_id, "as_is");
    if (!snapshot) return null;
    const parsed = processModelSchema.safeParse(JSON.parse(snapshot.model_json));
    if (!parsed.success) {
      throw new ApiError(500, "corrupt_model", "Stored as-is model failed validation", {});
    }
    return { snapshot, model: parsed.data };
  }

  function audit(store: LocalStore, project_id: string, actor: string | undefined, action: string, entity_refs: string[], detail: string) {
    store.audit.append({
      event_id: randomUUID(),
      project_id,
      run_id: randomUUID(),
      actor: actor ?? "local",
      action,
      entity_refs,
      detail,
    });
  }

  addRoute(routes, "POST", "/research/projects/:id/asis/draft", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const files = store.getEvidence(ctx.params.id);
    const gate = evaluateEvidenceGate(files);
    if (!gate.ready) {
      throw new ApiError(422, "evidence_not_ready", "Index evidence before drafting the as-is process", {
        reasons: gate.reasons,
      });
    }
    const indexed = files.filter((file) => file.status === "indexed");
    const claims = indexed.flatMap((file) => file.claims);
    const model = draftProcessModel({
      stage: "as_is",
      files: indexed.map((file, order) => ({ file_id: file.file_id, order })),
      claims,
    });
    const integrity = checkModelIntegrity(model);
    if (integrity.length > 0) {
      throw new ApiError(500, "draft_failed", "Drafted model failed integrity checks", { integrity });
    }
    const previous = store.latestSnapshot(ctx.params.id, "as_is");
    const snapshot = store.saveSnapshot({
      project_id: ctx.params.id,
      stage: "as_is",
      model_json: JSON.stringify(model),
      supersedes: previous?.id ?? null,
    });
    audit(store, ctx.params.id, ctx.actor?.clientId, "asis.drafted", [snapshot.id], `${model.steps.length} steps drafted from ${indexed.length} files`);
    return jsonResponse({ model, snapshot_id: snapshot.id }, 201);
  });

  addRoute(routes, "GET", "/research/projects/:id/asis", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const found = readModel(store, ctx.params.id);
    if (!found) return jsonResponse({ model: null, confirm: evaluateConfirmGate(null) });
    return jsonResponse({ model: found.model, confirm: evaluateConfirmGate(found.model) });
  });

  addRoute(routes, "POST", "/research/projects/:id/asis/steps/:stepId/pains", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const found = readModel(store, ctx.params.id);
    if (!found) {
      throw new ApiError(422, "no_draft", "Draft the as-is process before adding pains", {});
    }
    const body = await readJsonBody(ctx.request);
    const dimension = typeof body.dimension === "string" ? body.dimension.trim() : "";
    const finding = typeof body.finding === "string" ? body.finding.trim() : "";
    const severity = body.severity;
    const claim_ids = Array.isArray(body.claim_ids) ? body.claim_ids.filter((id): id is string => typeof id === "string") : [];
    if (!dimension || !finding) {
      throw new ApiError(422, "invalid_pain", "dimension and finding are required", {});
    }
    if (severity !== "low" && severity !== "medium" && severity !== "high") {
      throw new ApiError(422, "invalid_pain", "severity must be low, medium, or high", {});
    }
    const knownClaims = new Set(found.model.provenance.sources);
    const unknown = claim_ids.filter((id) => !knownClaims.has(id));
    if (unknown.length > 0) {
      throw new ApiError(422, "unknown_claims", "Every pain must cite evidence from this draft", { unknown });
    }
    const step = found.model.steps.find((candidate) => candidate.id === ctx.params.stepId);
    if (!step) {
      throw new ApiError(404, "step_not_found", "As-is step not found", { stepId: ctx.params.stepId });
    }
    const pain_id = randomUUID();
    const model = {
      ...found.model,
      steps: found.model.steps.map((candidate) =>
        candidate.id === step.id
          ? {
              ...candidate,
              pains: [...candidate.pains, { pain_id, dimension, finding, severity, claim_ids }],
              no_pain_reason: null,
            }
          : candidate,
      ),
    };
    const snapshot = store.saveSnapshot({
      project_id: ctx.params.id,
      stage: "as_is",
      model_json: JSON.stringify(model),
      supersedes: found.snapshot.id,
    });
    audit(store, ctx.params.id, ctx.actor?.clientId, "asis.pain_added", [snapshot.id, step.id], `${dimension}: ${finding.slice(0, 120)}`);
    return jsonResponse({ model, snapshot_id: snapshot.id }, 201);
  });

  addRoute(routes, "POST", "/research/projects/:id/asis/steps/:stepId/no-pain", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const found = readModel(store, ctx.params.id);
    if (!found) {
      throw new ApiError(422, "no_draft", "Draft the as-is process before clearing steps", {});
    }
    const body = await readJsonBody(ctx.request);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      throw new ApiError(422, "invalid_clearance", "A reason is required to clear a step", {});
    }
    if (!found.model.steps.some((candidate) => candidate.id === ctx.params.stepId)) {
      throw new ApiError(404, "step_not_found", "As-is step not found", { stepId: ctx.params.stepId });
    }
    const model = {
      ...found.model,
      steps: found.model.steps.map((candidate) =>
        candidate.id === ctx.params.stepId
          ? { ...candidate, pains: [], no_pain_reason: reason }
          : candidate,
      ),
    };
    const snapshot = store.saveSnapshot({
      project_id: ctx.params.id,
      stage: "as_is",
      model_json: JSON.stringify(model),
      supersedes: found.snapshot.id,
    });
    audit(store, ctx.params.id, ctx.actor?.clientId, "asis.step_cleared", [snapshot.id, ctx.params.stepId], reason.slice(0, 120));
    return jsonResponse({ model, snapshot_id: snapshot.id }, 201);
  });

  addRoute(routes, "POST", "/research/projects/:id/asis/confirm", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const found = readModel(store, ctx.params.id);
    if (!found) {
      throw new ApiError(422, "no_draft", "Draft the as-is process before confirming", {});
    }
    const confirm = evaluateConfirmGate(found.model);
    if (!confirm.ready) {
      throw new ApiError(422, "asis_incomplete", "Resolve every step before confirming", {
        reasons: confirm.reasons,
      });
    }
    store.setProjectPhase(ctx.params.id, "processing");
    audit(store, ctx.params.id, ctx.actor?.clientId, "asis.confirmed", [found.snapshot.id], `${confirm.total_count} steps confirmed`);
    return jsonResponse({ confirm, phase: "processing" });
  });

  function readProcessing(store: LocalStore, project_id: string) {
    const snapshot = store.latestSnapshot(project_id, "processing");
    if (!snapshot) return null;
    const parsed = processModelSchema.safeParse(JSON.parse(snapshot.model_json));
    if (!parsed.success) {
      throw new ApiError(500, "corrupt_model", "Stored simplification model failed validation", {});
    }
    return { snapshot, model: parsed.data };
  }

  function evidenceClaims(store: LocalStore, project_id: string) {
    const files = store.getEvidence(project_id);
    const byId = new Map<string, { file: string; page: number; section: string }>();
    for (const file of files) {
      for (const claim of file.claims) {
        byId.set(claim.claim_id, { file: file.name, page: claim.page, section: claim.section });
      }
    }
    return { files, byId };
  }

  addRoute(routes, "GET", "/research/projects/:id/constraints", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    return jsonResponse({ constraints: store.listConstraints(ctx.params.id) });
  });

  addRoute(routes, "POST", "/research/projects/:id/constraints", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const statement = typeof body.statement === "string" ? body.statement.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const claim_ids = Array.isArray(body.claim_ids) ? body.claim_ids.filter((id): id is string => typeof id === "string") : [];
    if (!statement || !reason) {
      throw new ApiError(422, "invalid_constraint", "statement and reason are required", {});
    }
    const { byId } = evidenceClaims(store, ctx.params.id);
    const unknown = claim_ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new ApiError(422, "unknown_claims", "Constraints must cite project evidence", { unknown });
    }
    const constraint = store.saveConstraint({
      project_id: ctx.params.id,
      statement,
      reason,
      claim_ids,
    });
    audit(store, ctx.params.id, ctx.actor?.clientId, "simplify.constraint_added", [constraint.constraint_id], statement.slice(0, 120));
    return jsonResponse({ constraint }, 201);
  });

  addRoute(routes, "POST", "/research/projects/:id/processing/propose", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    const project = requireProject(store, ctx.params.id);
    if (project.phase !== "processing") {
      throw new ApiError(422, "asis_not_confirmed", "Confirm the as-is process before proposing simplifications", {});
    }
    const asis = readModel(store, ctx.params.id);
    if (!asis) {
      throw new ApiError(422, "no_draft", "Draft the as-is process first", {});
    }
    const constraints = store.listConstraints(ctx.params.id);
    if (constraints.length === 0) {
      throw new ApiError(422, "no_constraints", "State what must stay before proposing changes", {});
    }
    const { files } = evidenceClaims(store, ctx.params.id);
    const claimsById = new Map(
      files.flatMap((file) => file.claims.map((claim) => [claim.claim_id, claim] as const)),
    );
    const model = proposeAll({ ...asis.model, stage: "processing" as const }, claimsById);
    const integrity = checkModelIntegrity(model);
    if (integrity.length > 0) {
      throw new ApiError(500, "propose_failed", "Proposed model failed integrity checks", { integrity });
    }
    const previous = store.latestSnapshot(ctx.params.id, "processing");
    const snapshot = store.saveSnapshot({
      project_id: ctx.params.id,
      stage: "processing",
      model_json: JSON.stringify(model),
      supersedes: previous?.id ?? null,
    });
    audit(store, ctx.params.id, ctx.actor?.clientId, "simplify.proposed", [snapshot.id], `${stepsMissingDecision(model).length} steps undecided`);
    return jsonResponse({ model, undecided: stepsMissingDecision(model) }, 201);
  });

  addRoute(routes, "GET", "/research/projects/:id/processing", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const found = readProcessing(store, ctx.params.id);
    if (!found) {
      return jsonResponse({
        model: null,
        undecided: [],
        constraints: store.listConstraints(ctx.params.id),
      });
    }
    return jsonResponse({
      model: found.model,
      undecided: stepsMissingDecision(found.model),
      constraints: store.listConstraints(ctx.params.id),
    });
  });

  addRoute(routes, "POST", "/research/projects/:id/processing/steps/:stepId/decide", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const found = readProcessing(store, ctx.params.id);
    if (!found) {
      throw new ApiError(422, "no_proposals", "Run proposals before deciding", {});
    }
    const body = await readJsonBody(ctx.request);
    const state = body.state;
    if (state !== "accepted" && state !== "rejected" && state !== "revised") {
      throw new ApiError(422, "invalid_decision", "state must be accepted, rejected, or revised", {});
    }
    const proposal = typeof body.proposal === "string" && body.proposal.trim() ? body.proposal.trim() : undefined;
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;
    if (state === "revised" && !proposal) {
      throw new ApiError(422, "invalid_decision", "A revised proposal text is required", {});
    }
    if (!found.model.steps.some((candidate) => candidate.id === ctx.params.stepId)) {
      throw new ApiError(404, "step_not_found", "Simplification step not found", { stepId: ctx.params.stepId });
    }
    const target = found.model.steps.find((candidate) => candidate.id === ctx.params.stepId);
    if (!target?.simplification) {
      const criterion_id = typeof body.criterion_id === "string" ? body.criterion_id.trim() : "";
      const action = typeof body.action === "string" && body.action.trim() ? body.action.trim() : criterion_id;
      const proposal = typeof body.proposal === "string" ? body.proposal.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!criterion_id || !proposal || !reason) {
        throw new ApiError(422, "no_proposal", "Undecided steps need criterion_id, proposal, and reason", {});
      }
      const { byId } = evidenceClaims(store, ctx.params.id);
      const claim_ids = Array.isArray(body.claim_ids) ? body.claim_ids.filter((id): id is string => typeof id === "string") : target?.claim_ids ?? [];
      const unknown = claim_ids.filter((id) => !byId.has(id));
      if (unknown.length > 0) {
        throw new ApiError(422, "unknown_claims", "Decisions must cite project evidence", { unknown });
      }
      const authored = authorStep(found.model, ctx.params.stepId, {
        criterion_id,
        action,
        proposal,
        reason,
        claim_ids,
        state,
        decided_by: ctx.actor?.clientId ?? "local",
      });
      const created = store.saveSnapshot({
        project_id: ctx.params.id,
        stage: "processing",
        model_json: JSON.stringify(authored),
        supersedes: found.snapshot.id,
      });
      audit(store, ctx.params.id, ctx.actor?.clientId, "simplify.decided", [created.id, ctx.params.stepId], `${state}: ${ctx.params.stepId} (authored)`);
      return jsonResponse({ model: authored, undecided: stepsMissingDecision(authored) }, 201);
    }
    const model = decideStep(found.model, ctx.params.stepId, {
      state,
      proposal,
      reason,
      decided_by: ctx.actor?.clientId ?? "local",
    });
    const snapshot = store.saveSnapshot({
      project_id: ctx.params.id,
      stage: "processing",
      model_json: JSON.stringify(model),
      supersedes: found.snapshot.id,
    });
    audit(store, ctx.params.id, ctx.actor?.clientId, "simplify.decided", [snapshot.id, ctx.params.stepId], `${state}: ${ctx.params.stepId}`);
    return jsonResponse({ model, undecided: stepsMissingDecision(model) }, 201);
  });
}
