/**
 * Heuristic draft v0: claims ordered by file and page collapse into steps
 * wherever consecutive claims share a section. Deterministic and fully
 * cited; an agent-driven draft replaces it when runner sessions land
 * (funnel phase). Provenance says `heuristic-v0` so no reviewer mistakes
 * it for agent work.
 */
import type { Claim } from "@openwork/research-templates/ports"
import type { ProcessModel, ProcessStep } from "@openwork/process-model/model"

function humanizeSection(section: string): string {
  return section
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase())
    .slice(0, 80)
}

function inferActor(text: string): string {
  if (/officer|review|approv|decid|board|authority/i.test(text)) return "Officer"
  if (/system|automat|registry|auto-|cross-check|bris|sms|notif/i.test(text)) return "System"
  return "Citizen"
}

export interface DraftInput {
  stage: ProcessModel["stage"]
  files: Array<{ file_id: string; order: number }>
  claims: Claim[]
}

export function draftProcessModel(input: DraftInput): ProcessModel {
  const fileOrder = new Map(input.files.map((file) => [file.file_id, file.order]))
  const ordered = [...input.claims].sort((a, b) => {
    const fileRank = (fileOrder.get(a.file_id) ?? 0) - (fileOrder.get(b.file_id) ?? 0)
    if (fileRank !== 0) return fileRank
    if (a.page !== b.page) return a.page - b.page
    return a.claim_id.localeCompare(b.claim_id)
  })

  const groups: Claim[][] = []
  for (const claim of ordered) {
    const current = groups[groups.length - 1]
    const previous = current?.[current.length - 1]
    if (
      current &&
      previous &&
      previous.file_id === claim.file_id &&
      previous.section === claim.section
    ) {
      current.push(claim)
    } else {
      groups.push([claim])
    }
  }

  const steps: ProcessStep[] = groups.map((group, index) => {
    const first = group[0]
    const combined = group.map((claim) => claim.quote).join(" ")
    return {
      id: `step-${index + 1}`,
      label: humanizeSection(first.section),
      detail: group.length > 1 ? `${first.quote} (+${group.length - 1} more)` : first.quote,
      actor: inferActor(`${first.section} ${combined}`),
      time: null,
      cost: null,
      visits: null,
      claim_ids: group.map((claim) => claim.claim_id),
    }
  })

  const lanes = ["Citizen", "Officer", "System"]
    .map((actor) => ({
      id: actor.toLowerCase(),
      label: actor,
      step_ids: steps.filter((step) => step.actor === actor).map((step) => step.id),
    }))
    .filter((lane) => lane.step_ids.length > 0)

  const edges = steps.slice(1).map((step, index) => ({
    from: steps[index].id,
    to: step.id,
  }))

  return {
    version: "1.0",
    stage: input.stage,
    steps,
    lanes,
    edges,
    provenance: {
      draft: "heuristic-v0",
      sources: ordered.map((claim) => claim.claim_id),
    },
  }
}
