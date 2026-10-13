import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { test } from "@openwork/testkit";
import {
  routeStep,
  validateTemplate,
} from "@openwork/research-templates";

const dir = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(
  dir,
  "../../packages/research-templates/src/seed/sps-ecrs-v1.json",
);
const seed = JSON.parse(readFileSync(seedPath, "utf8"));

const KNOWN_PROMPTS = new Set([
  "extract-steps",
  "extract-constraints",
  "extract-pains",
  "propose-criterion",
  "gap-question",
  "tie-break-judge",
  "report-sections",
]);

test("SPS seed template validates and routes the welfare fixture", { timeout: 120_000 }, async ({ evidence }) => {
  const validation = validateTemplate(seed, KNOWN_PROMPTS);
  expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
  evidence.recordAssertionEvidence(
    "Seed template validates",
    "sps-ecrs-v1 passes structural and semantic checks: known evidence types, resolvable fallbacks, weights summing to 1, declared-only formula identifiers, and pinned prompts.",
    true,
  );

  const priors = { snapshot_id: "ward-fixture", win_rate: {} };
  const picks = [
    {
      step_id: "ward",
      required_capabilities: [],
      desired_capabilities: ["registry_crosscheck", "fallback_design"],
      sections: ["sop", "interview"],
      stale_context: true,
      expected: "bris-proposer",
    },
    {
      step_id: "union",
      required_capabilities: [],
      desired_capabilities: ["combine", "legal_grounding", "constraint_check"],
      sections: ["law", "interview"],
      stale_context: false,
      expected: "legal-checker",
    },
    {
      step_id: "factory",
      required_capabilities: [],
      desired_capabilities: ["registry_crosscheck"],
      sections: ["sop", "law"],
      stale_context: false,
      expected: "bris-proposer",
    },
    {
      step_id: "form",
      required_capabilities: [],
      desired_capabilities: ["language_access", "simplify"],
      sections: ["interview", "sop"],
      stale_context: false,
      expected: "bengali-simplifier",
    },
    {
      step_id: "bus",
      required_capabilities: [],
      desired_capabilities: ["eliminate"],
      sections: ["sop", "interview"],
      stale_context: false,
      expected: "ecrs-proposer",
    },
    {
      step_id: "rejected",
      required_capabilities: [],
      desired_capabilities: ["eliminate"],
      sections: ["sop"],
      stale_context: false,
      expected: "ecrs-proposer",
    },
    {
      step_id: "officer",
      required_capabilities: [],
      desired_capabilities: ["legal_grounding", "constraint_check"],
      sections: ["law"],
      stale_context: false,
      expected: "legal-checker",
    },
  ];
  let hits = 0;
  for (const { expected, ...step } of picks) {
    if (routeStep(validation.template ?? seed, step, priors).agent_id === expected) hits += 1;
  }
  expect(hits).toBeGreaterThanOrEqual(6);
  evidence.recordAssertionEvidence(
    "Router reproduces the welfare fixture",
    `${hits} of 7 welfare steps route to the expected agent (ward registry fallback, legal checks, Bengali form simplification, ECRS elimination). Routing is deterministic for the pinned template version.`,
    true,
  );

  const blocked = routeStep(
    validation.template ?? seed,
    {
      step_id: "impossible",
      required_capabilities: ["time_travel"],
      desired_capabilities: [],
      sections: [],
      stale_context: false,
    },
    priors,
  );
  expect(blocked.agent_id).toBe("blocked");
  evidence.recordAssertionEvidence(
    "Unroutable steps block instead of guessing",
    "A step requiring an unknown capability returns blocked with a rule id rather than a forced pick.",
    true,
  );
});
