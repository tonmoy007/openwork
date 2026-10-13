import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  routeStep,
  type StepDescriptor,
} from "@openwork/research-templates/router"
import type { ResearchTemplate } from "@openwork/research-templates/schema"
import { validateTemplate } from "@openwork/research-templates/validate"

const dir = dirname(fileURLToPath(import.meta.url))
const template = JSON.parse(
  readFileSync(resolve(dir, "seed/sps-ecrs-v1.json"), "utf8"),
) as ResearchTemplate

const priors = { snapshot_id: "ward-fixture", win_rate: {} }

/** Welfare Grant steps with the expected router pick each. */
const cases: Array<{ step: StepDescriptor; expected: string }> = [
  {
    step: {
      step_id: "ward",
      required_capabilities: [],
      desired_capabilities: ["registry_crosscheck", "fallback_design"],
      sections: ["sop", "interview"],
      stale_context: true,
    },
    expected: "bris-proposer",
  },
  {
    step: {
      step_id: "union",
      required_capabilities: [],
      desired_capabilities: ["combine", "legal_grounding", "constraint_check"],
      sections: ["law", "interview"],
      stale_context: false,
    },
    expected: "legal-checker",
  },
  {
    step: {
      step_id: "factory",
      required_capabilities: [],
      desired_capabilities: ["registry_crosscheck"],
      sections: ["sop", "law"],
      stale_context: false,
    },
    expected: "bris-proposer",
  },
  {
    step: {
      step_id: "form",
      required_capabilities: [],
      desired_capabilities: ["language_access", "simplify"],
      sections: ["interview", "sop"],
      stale_context: false,
    },
    expected: "bengali-simplifier",
  },
  {
    step: {
      step_id: "bus",
      required_capabilities: [],
      desired_capabilities: ["eliminate"],
      sections: ["sop", "interview"],
      stale_context: false,
    },
    expected: "ecrs-proposer",
  },
  {
    step: {
      step_id: "rejected",
      required_capabilities: [],
      desired_capabilities: ["eliminate"],
      sections: ["sop"],
      stale_context: false,
    },
    expected: "ecrs-proposer",
  },
  {
    step: {
      step_id: "officer",
      required_capabilities: [],
      desired_capabilities: ["legal_grounding", "constraint_check"],
      sections: ["law"],
      stale_context: false,
    },
    expected: "legal-checker",
  },
]

test("seed template is routable", () => {
  const result = validateTemplate(template)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
})

for (const { step, expected } of cases) {
  test(`routes ${step.step_id} to ${expected}`, () => {
    const result = routeStep(template, step, priors)
    assert.equal(result.agent_id, expected)
    assert.equal(result.weights_version, "sps-ecrs-v1@1.0")
  })
}

test("router reproduces at least 6 of 7 welfare picks", () => {
  let hits = 0
  for (const { step, expected } of cases) {
    if (routeStep(template, step, priors).agent_id === expected) hits += 1
  }
  assert.ok(hits >= 6, `only ${hits}/7 matched`)
})

test("no eligible agent returns blocked", () => {
  const result = routeStep(
    template,
    {
      step_id: "impossible",
      required_capabilities: ["time_travel"],
      desired_capabilities: [],
      sections: [],
      stale_context: false,
    },
    priors,
  )
  assert.equal(result.agent_id, "blocked")
  assert.equal(result.rule_id, "no_eligible_agent")
})
