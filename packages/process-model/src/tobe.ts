/**
 * To-be builder v0: single variant from terminal decisions. Accepted
 * eliminations drop steps; everything else survives (revised steps carry
 * the revised proposal text). New steps (online submission, system
 * verification) arrive with agent proposals in P1-1 — v0 never invents
 * work, it only removes what decisions removed.
 */
import { z } from "zod"
import type { ProcessModel, ProcessStep } from "@openwork/process-model/model"

export const tobeStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  detail: z.string(),
  actor: z.string().min(1),
  origin: z.enum(["kept", "changed"]),
  source_step_ids: z.array(z.string().min(1)),
})

export const tobeVariantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  steps: z.array(tobeStepSchema),
  source_decisions: z.array(z.string().min(1)),
})

export type TobeVariant = z.infer<typeof tobeVariantSchema>

export interface TobeStep {
  id: string
  label: string
  detail: string
  actor: string
  origin: "kept" | "changed"
  source_step_ids: string[]
}

export interface TobeVariantInput {
  id: string
  label: string
  steps: TobeStep[]
  source_decisions: string[]
}

export function buildTobeVariant(
  model: ProcessModel,
  variantId: string,
  label: string,
): TobeVariantInput {
  const steps: TobeStep[] = []
  const source_decisions: string[] = []
  model.steps.forEach((step: ProcessStep) => {
    const simplification = step.simplification
    if (!simplification || simplification.state === "proposed") {
      throw new Error(`step "${step.id}" has no terminal decision`)
    }
    if (simplification.state === "accepted" && simplification.action === "eliminate") {
      source_decisions.push(`${step.id}:eliminated`)
      return
    }
    const changed = simplification.state === "revised"
    if (changed) source_decisions.push(`${step.id}:revised`)
    else source_decisions.push(`${step.id}:${simplification.state}`)
    steps.push({
      id: `tobe-${steps.length + 1}`,
      label: step.label,
      detail: changed ? simplification.proposal : step.detail,
      actor: step.actor,
      origin: changed ? "changed" : "kept",
      source_step_ids: [step.id],
    })
  })
  return { id: variantId, label, steps, source_decisions }
}
