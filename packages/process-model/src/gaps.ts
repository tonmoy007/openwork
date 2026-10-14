/**
 * Heuristic gap suggestions v0. Deterministic checks over steps and claims
 * that surface review prompts a researcher can answer or skip. Labeled
 * heuristic — agent-authored questions replace these when runner sessions
 * land. Every suggestion cites the step and the reason it fired.
 */
import type { Claim } from "@openwork/research-templates/ports"
import type { ProcessModel } from "@openwork/process-model/model"

export interface GapSuggestion {
  suggestion_id: string
  step_id: string | null
  question: string
  reason: string
}

export function suggestGaps(
  model: ProcessModel,
  claimsById: Map<string, Claim>,
): GapSuggestion[] {
  const suggestions: GapSuggestion[] = []
  const fileCount = new Map<string, Set<string>>()
  for (const step of model.steps) {
    const files = new Set<string>()
    for (const claim_id of step.claim_ids) {
      const claim = claimsById.get(claim_id)
      if (claim) files.add(claim.file_id)
    }
    fileCount.set(step.id, files)
    if (files.size <= 1 && step.claim_ids.length > 0) {
      suggestions.push({
        suggestion_id: `${step.id}-single-source`,
        step_id: step.id,
        question: `“${step.label}” rests on a single source. Is there corroborating evidence, or should another file be uploaded?`,
        reason: "single-source step",
      })
    }
    if (!step.time && !step.cost && !step.visits) {
      suggestions.push({
        suggestion_id: `${step.id}-no-measures`,
        step_id: step.id,
        question: `“${step.label}” has no time, cost, or visit figures. Are there numbers on file, or is this genuinely unmeasured?`,
        reason: "unmeasured step",
      })
    }
  }
  const allFiles = new Set<string>()
  for (const files of fileCount.values()) {
    for (const file of files) allFiles.add(file)
  }
  if (model.steps.length > 0 && allFiles.size <= 1) {
    suggestions.push({
      suggestion_id: "corpus-single-source",
      step_id: null,
      question:
        "The whole draft leans on one evidence file. Are there laws, forms, or interviews that should join the library?",
      reason: "single-source corpus",
    })
  }
  return suggestions
}
