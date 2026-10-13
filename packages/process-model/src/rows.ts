/**
 * Table rows for the as-is step table (#/Step/Actor/Time/Cost/Visits/Type
 * plus provenance). Unknown measures render as null and the UI shows "—".
 * Type stays `draft` until pains arrive (P0-5 assigns pain/core).
 */
import type { Claim } from "@openwork/research-templates/ports"
import type { ProcessModel } from "@openwork/process-model/model"

export interface TableSource {
  file: string
  page: number
  section: string
}

export interface TableRow {
  n: number
  step_id: string
  step: string
  detail: string
  actor: string
  time: string | null
  cost: string | null
  visits: string | null
  type: "draft" | "pain" | "core"
  claim_count: number
  sources: TableSource[]
}

export function tableRows(
  model: ProcessModel,
  claims: Map<string, { claim: Claim; file: string }>,
): TableRow[] {
  return model.steps.map((step, index) => {
    const sources: TableSource[] = []
    for (const claim_id of step.claim_ids) {
      const entry = claims.get(claim_id)
      if (!entry) continue
      sources.push({
        file: entry.file,
        page: entry.claim.page,
        section: entry.claim.section,
      })
    }
    return {
      n: index + 1,
      step_id: step.id,
      step: step.label,
      detail: step.detail,
      actor: step.actor,
      time: step.time,
      cost: step.cost,
      visits: step.visits,
      type: step.pains.length > 0 ? "pain" : "draft",
      claim_count: step.claim_ids.length,
      sources,
    }
  })
}
