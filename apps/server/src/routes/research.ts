import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
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
}
