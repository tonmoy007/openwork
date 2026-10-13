/**
 * G1 confirm evaluation in researcher words. Ready only when every step
 * has an actor and a pain or an explicit no-pain reason.
 */
import { stepsMissingResolution } from "@openwork/process-model/model"
import type { ProcessModel } from "@openwork/process-model/model"

export interface ConfirmGateResult {
  ready: boolean
  unresolved_count: number
  total_count: number
  reasons: string[]
}

export function evaluateConfirmGate(model: ProcessModel | null): ConfirmGateResult {
  if (!model) {
    return {
      ready: false,
      unresolved_count: 0,
      total_count: 0,
      reasons: ["Draft the as-is process first — it starts from indexed evidence."],
    }
  }
  const missing = stepsMissingResolution(model)
  if (missing.length === 0) {
    return {
      ready: true,
      unresolved_count: 0,
      total_count: model.steps.length,
      reasons: [
        `All ${model.steps.length} steps have an owner and a pain or an explicit all-clear.`,
      ],
    }
  }
  return {
    ready: false,
    unresolved_count: missing.length,
    total_count: model.steps.length,
    reasons: [
      `${missing.length} of ${model.steps.length} steps still need a pain or an explicit all-clear before confirming.`,
    ],
  }
}
