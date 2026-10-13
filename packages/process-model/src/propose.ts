/**
 * Heuristic proposals v0 (Eliminate/Keep only). Transparent tag rules stand
 * in for agent proposals until runner sessions land (P1-1): legal-tagged
 * officer steps are kept, duplication/travel/rework-tagged steps are
 * proposed for elimination, everything else awaits a researcher decision.
 * Provenance says `heuristic-p0` on every generated proposal reason.
 */
import type { Claim } from "@openwork/research-templates/ports"
import type { ProcessModel, ProcessStep, StepSimplification } from "@openwork/process-model/model"

function stepTags(step: ProcessStep, claimsById: Map<string, Claim>): Set<string> {
  const tags = new Set<string>()
  for (const claim_id of step.claim_ids) {
    const claim = claimsById.get(claim_id)
    if (claim) for (const tag of claim.tags) tags.add(tag)
  }
  return tags
}

function hasAny(tags: Set<string>, wanted: string[]): boolean {
  return wanted.some((tag) => tags.has(tag))
}

export function proposeForStep(
  step: ProcessStep,
  claimsById: Map<string, Claim>,
): Omit<StepSimplification, "state" | "revised_from" | "decided_by"> | null {
  if (step.simplification) return null
  const tags = stepTags(step, claimsById)
  if (step.actor === "Officer" && hasAny(tags, ["legal"])) {
    return {
      criterion_id: "keep",
      action: "keep",
      proposal: "Keep the officer decision step as is.",
      reason: "Named-officer decision required by cited legislation (heuristic-p0).",
      claim_ids: step.claim_ids,
    }
  }
  if (hasAny(tags, ["duplication", "registry"])) {
    return {
      criterion_id: "eliminate",
      action: "eliminate",
      proposal: "Eliminate this step via registry cross-check.",
      reason: "Duplicates data the government already holds (heuristic-p0).",
      claim_ids: step.claim_ids,
    }
  }
  if (hasAny(tags, ["travel"])) {
    return {
      criterion_id: "eliminate",
      action: "eliminate",
      proposal: "Eliminate the trip with an assisted or digital submission point.",
      reason: "In-person travel removable without losing the legal fact (heuristic-p0).",
      claim_ids: step.claim_ids,
    }
  }
  if (hasAny(tags, ["rework"])) {
    return {
      criterion_id: "eliminate",
      action: "eliminate",
      proposal: "Eliminate return trips with a pre-submission completeness check.",
      reason: "Rework caused by missing checklist, not by legal requirement (heuristic-p0).",
      claim_ids: step.claim_ids,
    }
  }
  return null
}

export function proposeAll(
  model: ProcessModel,
  claimsById: Map<string, Claim>,
): ProcessModel {
  return {
    ...model,
    steps: model.steps.map((step) => {
      const proposal = proposeForStep(step, claimsById)
      if (!proposal) return step
      return {
        ...step,
        simplification: { ...proposal, state: "proposed" as const, revised_from: null, decided_by: null },
      }
    }),
  }
}

export type DecisionState = "accepted" | "rejected" | "revised"

export function authorStep(
  model: ProcessModel,
  stepId: string,
  decision: {
    criterion_id: string
    action: string
    proposal: string
    reason: string
    claim_ids: string[]
    state: DecisionState
    decided_by: string
  },
): ProcessModel {
  return {
    ...model,
    steps: model.steps.map((step) => {
      if (step.id !== stepId || step.simplification) return step
      return {
        ...step,
        simplification: {
          criterion_id: decision.criterion_id,
          action: decision.action,
          proposal: decision.proposal,
          reason: decision.reason,
          claim_ids: decision.claim_ids,
          state: decision.state,
          revised_from: null,
          decided_by: decision.decided_by,
        },
      }
    }),
  }
}

export function decideStep(
  model: ProcessModel,
  stepId: string,
  decision: { state: DecisionState; proposal?: string; reason?: string; decided_by: string },
): ProcessModel {
  return {
    ...model,
    steps: model.steps.map((step) => {
      if (step.id !== stepId || !step.simplification) return step
      const previous = step.simplification
      return {
        ...step,
        simplification: {
          criterion_id: previous.criterion_id,
          action: previous.action,
          proposal: decision.proposal ?? previous.proposal,
          reason: decision.reason ?? previous.reason,
          claim_ids: previous.claim_ids,
          state: decision.state,
          revised_from:
            decision.state === "revised" && decision.proposal
              ? previous.proposal
              : previous.revised_from,
          decided_by: decision.decided_by,
        },
      }
    }),
  }
}

/** Partial G2: every step carries a terminal simplification state. */
export function stepsMissingDecision(model: ProcessModel): string[] {
  return model.steps
    .filter(
      (step) =>
        !step.simplification ||
        step.simplification.state === "proposed",
    )
    .map((step) => step.id)
}
