/**
 * Research template schema. Everything variable about a simplification
 * engagement lives in the template document; the engine only executes it.
 *
 * Template versions are `major.minor`: patch = prompts/formulas text,
 * minor = new criterion/measure/agent, major = breaking field removal.
 */
import { z } from "zod"

export const EVIDENCE_TYPES = [
  "sop",
  "law",
  "form",
  "bpmn",
  "interview",
  "survey",
  "observation",
] as const

export const OUTPUT_IDS = [
  "table",
  "bpmn_svg",
  "bpmn_xml",
  "impact_cards",
  "charts",
  "flow_visualizer",
  "report_html",
  "report_pdf",
  "blueprint_html",
  "blueprint_pdf",
  "decision_html",
  "decision_pdf",
  "table_xlsx",
  "decision_record",
] as const

export const ROUTING_PRESETS = [
  "balanced",
  "most_careful",
  "cheapest",
  "fastest",
  "custom",
] as const

const versionSchema = z
  .string()
  .regex(/^\d+\.\d+$/, "version must be major.minor")

const promptRefSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, "prompt_ref must be kebab-case")
  .describe("References prompts/<prompt_ref>.md at a pinned version")

const knowledgeSectionSchema = z.object({
  key: z.string().min(1),
  evidence_types: z.array(z.enum(EVIDENCE_TYPES)).min(1),
  extract: promptRefSchema,
})

const gapLoopSchema = z.object({
  max_rounds: z.number().int().positive().max(20),
  confirm_gate: z.enum(["user_accept"]),
  question_policy: z.enum(["one_at_a_time"]),
})

const asIsSchema = z.object({
  step_fields: z.array(z.string().min(1)).min(1),
  pain_dimensions: z.array(z.string().min(1)).min(1),
  gap_loop: gapLoopSchema,
})

const criterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  evaluation_prompt: promptRefSchema,
  needs_constraint: z.boolean(),
  heuristic: z
    .object({
      match_tags: z.array(z.string().min(1)).min(1),
      action: z.string().min(1),
      proposal: z.string().min(1),
      reason: z.string().min(1),
    })
    .optional(),
})

const simplificationSchema = z.object({
  constraint_capture: z.object({
    prompt: promptRefSchema,
    save_to: z.string().min(1),
  }),
  criteria: z.array(criterionSchema).min(1),
  decision_states: z.array(z.string().min(1)).min(1),
  back_edges: z.array(z.string().min(1)),
})

const costModelSchema = z.object({
  measures: z.array(z.string().min(1)).min(1),
  formulas: z.record(z.string(), z.string().min(1)),
  units: z.record(z.string(), z.string().min(1)),
})

const tobeSchema = z.object({
  policy: z.enum(["single", "multi_axis"]),
  axes: z.array(z.string().min(1)),
  side_by_side: z.boolean(),
})

const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  prompt_ref: promptRefSchema,
  model_pin: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  strength_sections: z.array(z.string().min(1)),
  fallback: z.string().min(1),
  cost: z.number().nonnegative(),
  latency: z.number().nonnegative(),
})

const routingWeightsSchema = z.object({
  capability: z.number().min(0).max(1),
  evidence: z.number().min(0).max(1),
  quality: z.number().min(0).max(1),
  cost: z.number().min(0).max(1),
  latency: z.number().min(0).max(1),
})

const routingSchema = z.object({
  mode: z.enum(["manual", "auto", "auto_with_override"]),
  decision_model: promptRefSchema,
  tie_break_margin: z.number().min(0).max(1),
  preset: z.enum(ROUTING_PRESETS),
  weights: routingWeightsSchema,
})

const fanOutSchema = z.object({
  scope: z.enum(["per_step", "per_section"]),
  task: z.string().min(1),
  concurrency_cap: z.number().int().positive().max(8),
})

const funnelSchema = z.object({
  conflict: z.string().min(1),
  quorum: z.string().min(1),
  provenance_required: z.boolean(),
})

const agentsSchema = z.object({
  definitions: z.array(agentDefinitionSchema).min(1),
  routing: routingSchema,
  fan_out: z.array(fanOutSchema).min(1),
  funnel: funnelSchema,
})

export const researchTemplateSchema = z.object({
  id: z.string().min(1),
  version: versionSchema,
  knowledge_sections: z.array(knowledgeSectionSchema).min(1),
  as_is: asIsSchema,
  simplification: simplificationSchema,
  cost_model: costModelSchema,
  tobe: tobeSchema,
  outputs: z.array(z.enum(OUTPUT_IDS)).min(1),
  agents: agentsSchema,
})

export type ResearchTemplate = z.infer<typeof researchTemplateSchema>
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>
export type RoutingWeights = z.infer<typeof routingWeightsSchema>
