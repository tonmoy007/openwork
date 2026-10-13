/**
 * Deterministic agent router. Template owns weights and presets; the engine
 * only executes: hard filter → weighted score → deterministic tie-break.
 * (P1 wires the pinned judge model for close margins; P0 breaks ties by
 * capability then cost so runs stay fully deterministic.)
 *
 * Overrides count into quality priors outside this module; priors arrive as
 * a snapshot so the same inputs always produce the same pick.
 */
import type { AgentDefinition, ResearchTemplate } from "@openwork/research-templates/schema"

export interface StepDescriptor {
  step_id: string
  required_capabilities: string[]
  desired_capabilities: string[]
  sections: string[]
  stale_context: boolean
}

export interface QualityPriors {
  snapshot_id: string
  /** Laplace-smoothed win rate per agent id, 0..1. Missing agents read 0.5. */
  win_rate: Record<string, number>
}

export interface RouteResult {
  agent_id: string
  rule_id: string
  scores: Record<string, number>
  tie: boolean
  weights_version: string
}

/** Agents carrying these capabilities are exempt from the staleness penalty. */
const STALE_EXEMPT_CAPABILITIES = ["fallback_design", "registry_crosscheck"]

const STALENESS_PENALTY = 0.15

function overlapFraction(have: string[], want: string[]): number {
  if (want.length === 0) return 1
  const set = new Set(have)
  let hits = 0
  for (const item of want) {
    if (set.has(item)) hits += 1
  }
  return hits / want.length
}

function normalizeCostLatency(
  definitions: AgentDefinition[],
): { cost: Record<string, number>; latency: Record<string, number> } {
  const costs = definitions.map((d) => d.cost)
  const latencies = definitions.map((d) => d.latency)
  const costRange = Math.max(...costs) - Math.min(...costs)
  const latencyRange = Math.max(...latencies) - Math.min(...latencies)
  const cost: Record<string, number> = {}
  const latency: Record<string, number> = {}
  for (const d of definitions) {
    cost[d.id] =
      costRange === 0 ? 0 : (d.cost - Math.min(...costs)) / costRange
    latency[d.id] =
      latencyRange === 0
        ? 0
        : (d.latency - Math.min(...latencies)) / latencyRange
  }
  return { cost, latency }
}

export function routeStep(
  template: ResearchTemplate,
  step: StepDescriptor,
  priors: QualityPriors,
): RouteResult {
  const weightsVersion = `${template.id}@${template.version}`
  const weights = template.agents.routing.weights

  const eligible = template.agents.definitions.filter((d) =>
    step.required_capabilities.every((cap) => d.capabilities.includes(cap)),
  )
  if (eligible.length === 0) {
    return {
      agent_id: "blocked",
      rule_id: "no_eligible_agent",
      scores: {},
      tie: false,
      weights_version: weightsVersion,
    }
  }

  const norm = normalizeCostLatency(eligible)
  const scores: Record<string, number> = {}
  for (const d of eligible) {
    const capability = overlapFraction(
      d.capabilities,
      step.desired_capabilities,
    )
    const evidence = overlapFraction(d.strength_sections, step.sections)
    const quality = priors.win_rate[d.id] ?? 0.5
    const stalePenalty =
      step.stale_context &&
      !STALE_EXEMPT_CAPABILITIES.some((cap) => d.capabilities.includes(cap))
        ? STALENESS_PENALTY
        : 0
    scores[d.id] =
      weights.capability * capability +
      weights.evidence * evidence +
      weights.quality * quality +
      weights.cost * (1 - norm.cost[d.id]) +
      weights.latency * (1 - norm.latency[d.id]) -
      stalePenalty
  }

  const ranked = [...eligible].sort((a, b) => {
    const gap = scores[b.id] - scores[a.id]
    if (gap !== 0) return gap
    const capA = overlapFraction(a.capabilities, step.desired_capabilities)
    const capB = overlapFraction(b.capabilities, step.desired_capabilities)
    if (capB !== capA) return capB - capA
    if (a.cost !== b.cost) return a.cost - b.cost
    return a.id.localeCompare(b.id)
  })

  const winner = ranked[0]
  const runnerUp = ranked[1]
  const tie =
    runnerUp !== undefined &&
    Math.abs(scores[winner.id] - scores[runnerUp.id]) <
      template.agents.routing.tie_break_margin

  return {
    agent_id: winner.id,
    rule_id: tie ? "tie_break_deterministic" : "weighted_score",
    scores,
    tie,
    weights_version: weightsVersion,
  }
}
