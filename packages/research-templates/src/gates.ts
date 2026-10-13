/**
 * Gate evaluation in researcher words. Pure functions over stored rows;
 * the UI disables advancement until `ready` is true and shows `reasons`
 * as progress copy (never gate codes).
 */
import type { EvidenceFile } from "@openwork/research-templates/ports"

export interface GateResult {
  ready: boolean
  indexed_count: number
  total_count: number
  reasons: string[]
}

/** G0: evidence ready — every file indexed, every file carrying claims. */
export function evaluateEvidenceGate(files: EvidenceFile[]): GateResult {
  const reasons: string[] = []
  const total_count = files.length
  if (total_count === 0) {
    return {
      ready: false,
      indexed_count: 0,
      total_count,
      reasons: ["Upload evidence first — SOPs, laws, forms, or interview notes."],
    }
  }
  const pending = files.filter((file) => file.status !== "indexed")
  for (const file of pending) {
    reasons.push(
      `${file.name} is still ${file.status} — it will join the workspace when indexing finishes.`,
    )
  }
  const empty = files.filter(
    (file) => file.status === "indexed" && file.claims.length === 0,
  )
  for (const file of empty) {
    reasons.push(
      `${file.name} finished indexing but yielded no readable sections — add a source with more detail or remove it.`,
    )
  }
  const indexed_count = files.filter((file) => file.status === "indexed").length
  const ready = pending.length === 0 && empty.length === 0
  if (ready) {
    const claimCount = files.reduce((sum, file) => sum + file.claims.length, 0)
    reasons.push(
      `${indexed_count} of ${total_count} files indexed with ${claimCount} evidence sections ready.`,
    )
  }
  return { ready, indexed_count, total_count, reasons }
}
