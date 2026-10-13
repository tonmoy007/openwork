/**
 * Template validation: structural (JSON Schema via zod) plus semantic
 * checks the schema alone cannot express.
 */
import {
  EVIDENCE_TYPES,
  researchTemplateSchema,
  type ResearchTemplate,
} from "@openwork/research-templates/schema"

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
  template?: ResearchTemplate
}

/** Cost formulas may reference these identifiers plus declared measures. */
const FORMULA_ALLOWLIST = new Set([
  "sum",
  "min",
  "max",
  "avg",
  "round",
  "ceil",
  "floor",
  "abs",
  "pct",
  "if",
  "as_is",
  "tobe",
  "true",
  "false",
  "null",
])

function formulaIdentifiers(formula: string): string[] {
  const matches = formula.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) ?? []
  return [...new Set(matches)]
}

export function validateTemplate(
  input: unknown,
  knownPrompts?: Set<string>,
): ValidationResult {
  const parsed = researchTemplateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    }
  }
  const template = parsed.data
  const issues: ValidationIssue[] = []

  const evidenceSet = new Set<string>(EVIDENCE_TYPES)
  for (const [index, section] of template.knowledge_sections.entries()) {
    for (const type of section.evidence_types) {
      if (!evidenceSet.has(type)) {
        issues.push({
          path: `knowledge_sections.${index}.evidence_types`,
          message: `unknown evidence type "${type}"`,
        })
      }
    }
  }

  const agentIds = new Set(template.agents.definitions.map((d) => d.id))
  for (const [index, definition] of template.agents.definitions.entries()) {
    if (!agentIds.has(definition.fallback)) {
      issues.push({
        path: `agents.definitions.${index}.fallback`,
        message: `fallback "${definition.fallback}" is not a defined agent`,
      })
    }
  }

  const weights = template.agents.routing.weights
  const weightSum =
    weights.capability +
    weights.evidence +
    weights.quality +
    weights.cost +
    weights.latency
  if (Math.abs(weightSum - 1) > 0.001) {
    issues.push({
      path: "agents.routing.weights",
      message: `weights must sum to 1, got ${weightSum.toFixed(3)}`,
    })
  }

  const declaredMeasures = new Set(template.cost_model.measures)
  for (const [name, formula] of Object.entries(template.cost_model.formulas)) {
    for (const identifier of formulaIdentifiers(formula)) {
      const root = identifier.split(".")[0]
      if (!FORMULA_ALLOWLIST.has(root) && !declaredMeasures.has(root)) {
        issues.push({
          path: `cost_model.formulas.${name}`,
          message: `formula references undeclared measure or function "${root}"`,
        })
      }
    }
    if (/(fetch|XMLHttpRequest|eval|Function|while|for|globalThis|process|require|import)\b/.test(formula)) {
      issues.push({
        path: `cost_model.formulas.${name}`,
        message: "formula uses a denied construct",
      })
    }
  }

  if (knownPrompts) {
    const promptRefs: Array<[string, string]> = [
      ...template.knowledge_sections.map(
        (s): [string, string] => [`knowledge_sections.${s.key}`, s.extract],
      ),
      ...template.simplification.criteria.map(
        (c): [string, string] => [
          `simplification.criteria.${c.id}`,
          c.evaluation_prompt,
        ],
      ),
      ...template.agents.definitions.map(
        (d): [string, string] => [`agents.definitions.${d.id}`, d.prompt_ref],
      ),
      [
        "agents.routing.decision_model",
        template.agents.routing.decision_model,
      ],
      [
        "simplification.constraint_capture",
        template.simplification.constraint_capture.prompt,
      ],
    ]
    for (const [path, ref] of promptRefs) {
      if (!knownPrompts.has(ref)) {
        issues.push({ path, message: `missing prompt "${ref}"` })
      }
    }
  }

  const validOutputs = template.outputs.length > 0
  if (!validOutputs) {
    issues.push({ path: "outputs", message: "at least one output required" })
  }

  return { ok: issues.length === 0, issues, template }
}
