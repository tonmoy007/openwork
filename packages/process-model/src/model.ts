/**
 * ProcessModel schema: one model, many renderers (table, BPMN SVG,
 * exports). Lanes group steps by actor; edges order them. Every step
 * carries the claim ids that justify it — rendering without sources
 * is a defect.
 */
import { z } from "zod"

export const PROCESS_STAGES = ["as_is", "processing", "to_be"] as const

const stepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  detail: z.string(),
  actor: z.string().min(1),
  time: z.string().nullable(),
  cost: z.string().nullable(),
  visits: z.string().nullable(),
  claim_ids: z.array(z.string().min(1)).min(1),
})

const laneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  step_ids: z.array(z.string().min(1)).min(1),
})

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
})

export const processModelSchema = z.object({
  version: z.literal("1.0"),
  stage: z.enum(PROCESS_STAGES),
  steps: z.array(stepSchema).min(1),
  lanes: z.array(laneSchema).min(1),
  edges: z.array(edgeSchema),
  provenance: z.object({
    draft: z.string().min(1),
    sources: z.array(z.string().min(1)),
  }),
})

export type ProcessModel = z.infer<typeof processModelSchema>
export type ProcessStep = ProcessModel["steps"][number]

export interface ModelIssue {
  path: string
  message: string
}

/** Structural integrity: unique ids, edges and lanes referencing steps. */
export function checkModelIntegrity(model: ProcessModel): ModelIssue[] {
  const issues: ModelIssue[] = []
  const ids = new Set<string>()
  for (const [index, step] of model.steps.entries()) {
    if (ids.has(step.id)) {
      issues.push({ path: `steps.${index}.id`, message: `duplicate step id "${step.id}"` })
    }
    ids.add(step.id)
  }
  model.edges.forEach((edge, index) => {
    if (!ids.has(edge.from)) {
      issues.push({ path: `edges.${index}.from`, message: `unknown step "${edge.from}"` })
    }
    if (!ids.has(edge.to)) {
      issues.push({ path: `edges.${index}.to`, message: `unknown step "${edge.to}"` })
    }
  })
  model.lanes.forEach((lane, index) => {
    lane.step_ids.forEach((step_id) => {
      if (!ids.has(step_id)) {
        issues.push({ path: `lanes.${index}.step_ids`, message: `unknown step "${step_id}"` })
      }
    })
  })
  const covered = new Set(model.lanes.flatMap((lane) => lane.step_ids))
  for (const step of model.steps) {
    if (!covered.has(step.id)) {
      issues.push({ path: `lanes`, message: `step "${step.id}" is in no lane` })
    }
  }
  return issues
}

/** G1 entry rule: every step carries at least one claim (schema already enforces non-empty). */
export function stepsHaveClaims(model: ProcessModel): string[] {
  return model.steps.filter((step) => step.claim_ids.length === 0).map((step) => step.id)
}
