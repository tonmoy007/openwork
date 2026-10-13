import { expect } from "vitest";
import { test } from "@openwork/testkit";
import {
  CostError,
  evaluateFormula,
  projectCosts,
} from "@openwork/process-model/cost";

const MEASURES = new Set(["visits", "time_to_decision", "out_of_pocket", "steps"]);

test("SPS cost sandbox is deterministic, denied by default, and exact on welfare", { timeout: 120_000 }, async ({ evidence }) => {
  const context = {
    as_is: { visits: [3, 1, 1, 1, 2, 2, 0], out_of_pocket: [0, 0, 0, 400, 600, 0, 0] },
    tobe: { visits: [0, 1, 0], out_of_pocket: [0, 0, 0] },
  };
  const first = evaluateFormula("pct(sum(as_is.visits), sum(tobe.visits))", context, MEASURES);
  const second = evaluateFormula("pct(sum(as_is.visits), sum(tobe.visits))", context, MEASURES);
  expect(first).toEqual(second);
  expect(first.value).toBe(90);
  evidence.recordAssertionEvidence(
    "Cost formulas are deterministic",
    "The welfare visits projection replays to 90% twice with no model calls.",
    true,
  );

  for (const formula of [
    "fetch(as_is.visits)",
    "while(true)",
    "globalThis.visits",
    "Date(as_is.visits)",
    "as_is.teleport",
  ]) {
    expect(() => evaluateFormula(formula, context, MEASURES), formula).toThrowError(CostError);
  }
  evidence.recordAssertionEvidence(
    "Unknown constructs are denied",
    "Network, loops, globals, dates, and undeclared measures throw typed errors naming the formula.",
    true,
  );

  const zero = evaluateFormula("10 / 0", { as_is: {}, tobe: {} }, MEASURES);
  expect(zero.value).toBeNull();
  expect(zero.warnings.length).toBeGreaterThan(0);

  const steps = [
    { time: "4 days", cost: null, visits: "3" },
    { time: "3 hours", cost: null, visits: "1" },
    { time: "15 min", cost: null, visits: null },
  ];
  const [visits, , , count] = projectCosts(steps, new Set(["s1"]), ["s1", "s2", "s3"]);
  expect(visits.before).toBe(4);
  expect(visits.after).toBe(1);
  expect(visits.pct).toBe(75);
  expect(count.before).toBe(3);
  expect(count.after).toBe(2);
  evidence.recordAssertionEvidence(
    "Projection diffs before and after elimination",
    "Removing one of three steps drops visits 4 to 1 and step count 3 to 2.",
    true,
  );
});
