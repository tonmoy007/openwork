import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { SEED_TEMPLATES } from "@openwork/research-templates/seed";
import { evaluateConfirmGate } from "@openwork/process-model/gates";
import { draftProcessModel } from "@openwork/process-model/draft";
import { checkModelIntegrity, processModelSchema } from "@openwork/process-model/model";
import { suggestGaps } from "@openwork/process-model/gaps";
import { authorStep, decideStep, proposeAll, stepsMissingDecision } from "@openwork/process-model/propose";
import { buildTobeVariant, tobeVariantSchema } from "@openwork/process-model/tobe";
import { modelToXml, variantToXml } from "@openwork/process-model/bpmn";
import { projectCosts } from "@openwork/process-model/cost";
import { buildDecisionRecord, buildSimplificationReport } from "@openwork/process-model/report";
import { buildDecisionWorkbook } from "@openwork/process-model/xlsx";
import { extractClaims, bpmnTaskClaims } from "@openwork/research-templates/claims";
import { evaluateEvidenceGate } from "@openwork/research-templates/gates";
import { extractEvidenceText } from "../research/evidence-text.js";
import { openStore, type LocalStore } from "@openwork/research-templates/adapters/local-sqlite";
import { StoreError } from "@openwork/research-templates/ports";
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
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = typeof body.type === "string" ? body.type : "sop";
    const textInput = typeof body.text === "string" ? body.text : "";
    const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
    if (!name || (!textInput && !dataBase64)) {
      throw new ApiError(422, "invalid_evidence", "name and text or file bytes are required", {});
    }
    const file_id = randomUUID();
    if (textInput && Buffer.byteLength(textInput, "utf8") > MAX_EVIDENCE_TEXT_BYTES) {
      throw new ApiError(413, "evidence_too_large", "Evidence text exceeds 5 MB", {});
    }
    const fail = (reason: string, status = 422): never => {
      store.saveEvidence({
        file_id,
        project_id: ctx.params.id,
        name,
        type,
        size: 0,
        status: "failed",
        claims: [],
      });
      throw new ApiError(status, "evidence_failed", reason, {});
    };
    if (textInput) {
      const claims = extractClaims(file_id, textInput, type);
      const file = store.saveEvidence({
        file_id,
        project_id: ctx.params.id,
        name,
        type,
        size: Buffer.byteLength(textInput, "utf8"),
        status: "indexed",
        claims,
      });
      return jsonResponse(
        { file, gate: evaluateEvidenceGate(store.getEvidence(ctx.params.id)) },
        201,
      );
    }
    let bytes: Uint8Array;
    try {
      const raw = Buffer.from(dataBase64, "base64");
      if (raw.byteLength === 0) return fail("The file arrived empty.");
      if (raw.byteLength > MAX_EVIDENCE_TEXT_BYTES) {
        return fail("Files larger than 5 MB are not supported yet.", 413);
      }
      const copy = new Uint8Array(raw.byteLength);
      copy.set(raw);
      bytes = copy;
    } catch {
      return fail("The file bytes are not valid base64.");
    }
    let extracted: { text: string; taskLabels: string[] };
    try {
      extracted = await extractEvidenceText(name, type, bytes);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "The file could not be read.");
    }
    const claims = [
      ...extractClaims(file_id, extracted.text, type),
      ...bpmnTaskClaims(file_id, extracted.taskLabels),
    ];
    if (claims.length === 0) {
      return fail("The file indexed but yielded no readable sections.");
    }
    const file = store.saveEvidence({
      file_id,
      project_id: ctx.params.id,
      name,
      type,
      size: bytes.byteLength,
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
    const openQuestions = store
      .listQuestions(ctx.params.id, "as_is")
      .filter((question) => question.status === "open");
    if (openQuestions.length > 0) {
      throw new ApiError(422, "questions_open", "Answer or skip open questions before confirming", {
        open: openQuestions.length,
      });
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

  function readTobe(store: LocalStore, project_id: string) {
    const snapshot = store.latestSnapshot(project_id, "to_be");
    if (!snapshot) return null;
    const parsed = tobeVariantSchema.safeParse(JSON.parse(snapshot.model_json));
    if (!parsed.success) {
      throw new ApiError(500, "corrupt_variant", "Stored to-be variant failed validation", {});
    }
    return { snapshot, variant: parsed.data };
  }

  addRoute(routes, "POST", "/research/projects/:id/tobe/build", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const processing = readProcessing(store, ctx.params.id);
    if (!processing) {
      throw new ApiError(422, "no_decisions", "Decide every simplification before building to-be", {});
    }
    const undecided = stepsMissingDecision(processing.model);
    if (undecided.length > 0) {
      throw new ApiError(422, "decisions_incomplete", "Decide every step before building to-be", { undecided });
    }
    const variant = buildTobeVariant(processing.model, "v1", "Proposed to-be");
    const previous = store.latestSnapshot(ctx.params.id, "to_be");
    const snapshot = store.saveSnapshot({
      project_id: ctx.params.id,
      stage: "to_be",
      model_json: JSON.stringify(variant),
      supersedes: previous?.id ?? null,
    });
    audit(store, ctx.params.id, ctx.actor?.clientId, "tobe.built", [snapshot.id], `${variant.steps.length} steps in v1`);
    return jsonResponse({ variant, snapshot_id: snapshot.id }, 201);
  });

  addRoute(routes, "GET", "/research/projects/:id/tobe", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const found = readTobe(store, ctx.params.id);
    if (!found) return jsonResponse({ variant: null });
    return jsonResponse({ variant: found.variant });
  });

  addRoute(routes, "POST", "/research/projects/:id/tobe/approve", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const found = readTobe(store, ctx.params.id);
    if (!found) {
      throw new ApiError(422, "no_variant", "Build the to-be variant before approving", {});
    }
    const actor = ctx.actor?.clientId ?? "local";
    const members = store.listMembers(ctx.params.id);
    const role = members.find((member) => member.user_ref === actor)?.local_role;
    const solo = members.length <= 1;
    if (role !== "reviewer" && !solo) {
      throw new ApiError(403, "reviewer_only", "Only a reviewer can approve the to-be process", {});
    }
    store.setProjectPhase(ctx.params.id, "approved");
    audit(
      store,
      ctx.params.id,
      actor,
      "tobe.approved",
      [found.snapshot.id],
      solo && role !== "reviewer" ? "solo researcher approval" : "reviewer approval",
    );
    return jsonResponse({ variant: found.variant, phase: "approved" });
  });

  interface ExportFile {
    name: string;
    kind: "bpmn" | "report" | "decision" | "xlsx";
    contentType: string;
    bytes: Uint8Array<ArrayBuffer>;
    sha256: string;
  }

  function freshBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy
  }

  function slugify(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "project";
  }

  function buildExportPack(store: LocalStore, project_id: string): { slug: string; files: ExportFile[] } {
    const project = requireProject(store, project_id);
    const slug = slugify(project.name);
    const processing = readProcessing(store, project_id);
    if (!processing) {
      throw new ApiError(422, "no_decisions", "Decide simplifications before exporting", {});
    }
    const tobe = readTobe(store, project_id);
    if (!tobe) {
      throw new ApiError(422, "no_variant", "Build the to-be variant before exporting", {});
    }
    const { files } = evidenceClaims(store, project_id);
    const claimFile = new Map<string, string>();
    for (const file of files) {
      for (const claim of file.claims) {
        claimFile.set(claim.claim_id, `${file.name} p${claim.page}`);
      }
    }
    const eliminated = new Set(
      processing.model.steps
        .filter(
          (step) =>
            step.simplification?.state === "accepted" && step.simplification.action === "eliminate",
        )
        .map((step) => step.id),
    );
    const costs = projectCosts(
      processing.model.steps,
      eliminated,
      processing.model.steps.map((step) => step.id),
    );
    const reportSteps = processing.model.steps.map((step, index) => ({
      n: index + 1,
      label: step.label,
      actor: step.actor,
      decision: step.simplification
        ? `${step.simplification.state} ${step.simplification.action}`
        : "undecided",
      reason: step.simplification?.reason ?? step.simplification?.proposal ?? "",
      sources: step.claim_ids.map((id) => claimFile.get(id) ?? id),
    }));
    const reportInput = {
      projectName: project.name,
      template_ref: project.template_ref,
      snapshot_id: tobe.snapshot.id,
      runStamp: `snapshot ${tobe.snapshot.id}`,
      steps: reportSteps,
      constraints: store
        .listConstraints(project_id)
        .map((constraint) => ({ statement: constraint.statement, reason: constraint.reason })),
      costs,
    };
    const decisionRows = [
      ["#", "Step", "Owner", "Decision", "Reason", "Sources"],
      ...reportSteps.map((step) => [
        String(step.n),
        step.label,
        processing.model.steps[step.n - 1]?.actor ?? "",
        step.decision,
        step.reason,
        step.sources.join("; "),
      ]),
    ];
    const encoder = new TextEncoder();
    const raw: Array<Omit<ExportFile, "sha256">> = [
      {
        name: `${slug}-TOBE.bpmn`,
        kind: "bpmn",
        contentType: "application/xml",
        bytes: encoder.encode(variantToXml(tobe.variant)),
      },
      {
        name: `${slug}-ASIS.bpmn`,
        kind: "bpmn",
        contentType: "application/xml",
        bytes: encoder.encode(modelToXml(processing.model)),
      },
      {
        name: `${slug}-report.html`,
        kind: "report",
        contentType: "text/html",
        bytes: encoder.encode(buildSimplificationReport(reportInput)),
      },
      {
        name: `${slug}-decision.html`,
        kind: "decision",
        contentType: "text/html",
        bytes: encoder.encode(buildDecisionRecord(reportInput)),
      },
      {
        name: `${slug}-decisions.xlsx`,
        kind: "xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: freshBytes(buildDecisionWorkbook(decisionRows)),
      },
    ];
    const hashed: ExportFile[] = raw.map((file) => ({
      ...file,
      bytes: freshBytes(file.bytes),
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
    }));
    return { slug, files: hashed };
  }

  function serveFile(file: ExportFile): Response {
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "X-Content-Sha256": file.sha256,
      },
    });
  }

  addRoute(routes, "GET", "/research/projects/:id/questions", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const url = new URL(ctx.request.url);
    const stage = url.searchParams.get("stage") ?? undefined;
    return jsonResponse({ questions: store.listQuestions(ctx.params.id, stage ?? undefined) });
  });

  addRoute(routes, "POST", "/research/projects/:id/questions/suggest", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const stage = typeof body.stage === "string" && body.stage ? body.stage : "as_is";
    const found = readModel(store, ctx.params.id);
    if (!found) {
      throw new ApiError(422, "no_draft", "Draft the as-is process before asking for gaps", {});
    }
    const { files } = evidenceClaims(store, ctx.params.id);
    const claimsById = new Map(
      files.flatMap((file) => file.claims.map((claim) => [claim.claim_id, claim] as const)),
    );
    const existing = new Set(
      store
        .listQuestions(ctx.params.id, stage)
        .filter((question) => question.status === "open")
        .map((question) => question.question),
    );
    const created = [];
    for (const suggestion of suggestGaps(found.model, claimsById)) {
      if (existing.has(suggestion.question)) continue;
      created.push(
        store.saveQuestion({
          project_id: ctx.params.id,
          stage,
          step_id: suggestion.step_id,
          question: suggestion.question,
          agent: "heuristic-v0",
        }),
      );
    }
    audit(store, ctx.params.id, ctx.actor?.clientId, "asis.gaps_suggested", [], `${created.length} questions`);
    return jsonResponse({ questions: created }, 201);
  });

  addRoute(routes, "POST", "/research/projects/:id/questions/:qid/answer", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    if (!answer) {
      throw new ApiError(422, "invalid_answer", "An answer is required", {});
    }
    const updated = store.answerQuestion(ctx.params.qid, answer);
    if (!updated) {
      throw new ApiError(404, "question_not_found", "Open question not found", { qid: ctx.params.qid });
    }
    audit(store, ctx.params.id, ctx.actor?.clientId, "asis.question_answered", [updated.question_id], answer.slice(0, 120));
    return jsonResponse({ question: updated });
  });

  addRoute(routes, "POST", "/research/projects/:id/questions/:qid/skip", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    if (!store.skipQuestion(ctx.params.qid)) {
      throw new ApiError(404, "question_not_found", "Open question not found", { qid: ctx.params.qid });
    }
    audit(store, ctx.params.id, ctx.actor?.clientId, "asis.question_skipped", [ctx.params.qid], "skipped");
    return jsonResponse({ skipped: true });
  });

  addRoute(routes, "GET", "/research/projects/:id/export", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const pack = buildExportPack(store, ctx.params.id);
    return jsonResponse({
      files: pack.files.map((file) => ({
        name: file.name,
        kind: file.kind,
        size: file.bytes.byteLength,
        sha256: file.sha256,
      })),
    });
  });

  const exportFiles = {
    "tobe.bpmn": (file: ExportFile) => file.kind === "bpmn" && file.name.includes("-TOBE."),
    "asis.bpmn": (file: ExportFile) => file.kind === "bpmn" && file.name.includes("-ASIS."),
    "report.html": (file: ExportFile) => file.kind === "report",
    "decision.html": (file: ExportFile) => file.kind === "decision",
    "decisions.xlsx": (file: ExportFile) => file.kind === "xlsx",
  } as const;
  for (const [fileName, matches] of Object.entries(exportFiles)) {
    addRoute(routes, "GET", `/research/projects/:id/export/${fileName}`, "client", async (ctx) => {
      ensureWritable(config);
      const store = await storeFor(config);
      requireProject(store, ctx.params.id);
      const pack = buildExportPack(store, ctx.params.id);
      const file = pack.files.find((candidate) => matches(candidate));
      if (!file) {
        throw new ApiError(404, "export_missing", "Export file not found", { file: fileName });
      }
      audit(store, ctx.params.id, ctx.actor?.clientId, "export.downloaded", [file.name], `${file.name} ${file.sha256.slice(0, 12)}`);
      return serveFile(file);
    });
  }

  addRoute(routes, "GET", "/research/templates", "client", async () => {
    ensureWritable(config);
    const store = await storeFor(config);
    const entries = new Map<string, string[]>();
    for (const row of store.templates.listLocal()) {
      const versions = entries.get(row.template_id) ?? [];
      versions.push(row.version);
      entries.set(row.template_id, versions);
    }
    return jsonResponse({
      templates: [...entries.entries()].map(([id, versions]) => ({ id, versions })),
    });
  });

  addRoute(routes, "GET", "/research/templates/:id", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    const url = new URL(ctx.request.url);
    const version = url.searchParams.get("version") ?? undefined;
    const found = store.templates.getTemplate(ctx.params.id, version ?? undefined);
    if (!found) {
      throw new ApiError(404, "template_not_found", "Research template not found", { id: ctx.params.id });
    }
    return jsonResponse({ doc_json: found.doc_json, version: found.version, hash: found.doc_hash });
  });

  addRoute(routes, "POST", "/research/templates/drafts", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    const body = await readJsonBody(ctx.request);
    if (typeof body.doc_json !== "string" || !body.doc_json.trim()) {
      throw new ApiError(422, "invalid_draft", "doc_json is required", {});
    }
    try {
      const saved = store.templates.saveDraft(body.doc_json);
      return jsonResponse(
        { id: saved.template_id, version: saved.version, hash: saved.doc_hash },
        201,
      );
    } catch (error) {
      if (error instanceof StoreError) {
        throw new ApiError(422, "invalid_draft", error.message, { code: error.code });
      }
      throw error;
    }
  });

  addRoute(routes, "POST", "/research/templates/:id/clone", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    try {
      const copy = store.templates.clone(ctx.params.id);
      return jsonResponse({ id: copy.template_id, version: copy.version }, 201);
    } catch (error) {
      if (error instanceof StoreError) {
        throw new ApiError(404, "template_not_found", error.message, {});
      }
      throw error;
    }
  });

  addRoute(routes, "POST", "/research/templates/seed", "client", async () => {
    ensureWritable(config);
    const store = await storeFor(config);
    const installed: Array<{ id: string; version: string }> = [];
    for (const seed of SEED_TEMPLATES) {
      const parsed = JSON.parse(seed.doc_json) as { id?: unknown; version?: unknown };
      const existing =
        typeof parsed.id === "string" && typeof parsed.version === "string"
          ? store.templates.getTemplate(parsed.id, parsed.version)
          : null;
      if (existing) {
        installed.push({ id: existing.template_id, version: existing.version });
        continue;
      }
      const saved = store.templates.saveDraft(seed.doc_json);
      installed.push({ id: saved.template_id, version: saved.version });
    }
    return jsonResponse({ installed }, 201);
  });

  addRoute(routes, "POST", "/research/projects/:id/assign", "client", async (ctx) => {
    ensureWritable(config);
    const store = await storeFor(config);
    requireProject(store, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    if (typeof body.template_ref !== "string" || !body.template_ref.includes("@")) {
      throw new ApiError(422, "invalid_template_ref", "template_ref must look like id@version", {});
    }
    const [id, version] = body.template_ref.split("@");
    if (!store.templates.getTemplate(id, version)) {
      throw new ApiError(422, "unknown_template", "No such template version in the local library", {
        template_ref: body.template_ref,
      });
    }
    store.templates.assignLocal(ctx.params.id, body.template_ref);
    return jsonResponse({ template_ref: body.template_ref });
  });
}
