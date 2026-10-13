import assert from "node:assert/strict"
import { test } from "node:test"
import {
  CostError,
  evaluateFormula,
  measureValue,
  projectCosts,
} from "@openwork/process-model/cost"

const MEASURES = new Set(["visits", "time_to_decision", "out_of_pocket", "steps"])

function context() {
  return {
    as_is: { visits: [3, 1, 1, 1, 2, 2, 0], out_of_pocket: [0, 0, 0, 400, 600, 0, 0] },
    tobe: { visits: [0, 1, 0], out_of_pocket: [0, 0, 0] },
  }
}

test("welfare worked example: visits saved and pct", () => {
  const saved = evaluateFormula("sum(as_is.visits) - sum(tobe.visits)", context(), MEASURES)
  assert.equal(saved.value, 9)
  assert.deepEqual(saved.warnings, [])
  const pct = evaluateFormula("pct(sum(as_is.visits), sum(tobe.visits))", context(), MEASURES)
  assert.equal(pct.value, 90)
})

test("arithmetic, comparisons, and if", () => {
  const ctx = { as_is: {}, tobe: {} }
  assert.equal(evaluateFormula("1 + 2 * 3", ctx, MEASURES).value, 7)
  assert.equal(evaluateFormula("(1 + 2) * 3", ctx, MEASURES).value, 9)
  assert.equal(evaluateFormula("10 / 4", ctx, MEASURES).value, 2.5)
  assert.equal(evaluateFormula("3 > 2", ctx, MEASURES).value, 1)
  assert.equal(evaluateFormula("2 == 3", ctx, MEASURES).value, 0)
  assert.equal(evaluateFormula("if(1, 10, 20)", ctx, MEASURES).value, 10)
  assert.equal(evaluateFormula("if(0, 10, 20)", ctx, MEASURES).value, 20)
  assert.equal(evaluateFormula("abs(0 - 5) + round(2.4) + ceil(2.1) + floor(2.9)", ctx, MEASURES).value, 12)
  assert.equal(evaluateFormula("min(as_is.visits) + max(as_is.visits) + avg(tobe.visits)", context(), MEASURES).value, 3.3333)
})

test("evaluation is deterministic", () => {
  const formula = "pct(sum(as_is.visits), sum(tobe.visits)) + avg(as_is.out_of_pocket)"
  const first = evaluateFormula(formula, context(), MEASURES)
  const second = evaluateFormula(formula, context(), MEASURES)
  assert.deepEqual(first, second)
})

test("division by zero yields null with a warning", () => {
  const result = evaluateFormula("10 / 0", { as_is: {}, tobe: {} }, MEASURES)
  assert.equal(result.value, null)
  assert.ok(result.warnings.length > 0)
  const pctZero = evaluateFormula("pct(0, 0)", { as_is: {}, tobe: {} }, MEASURES)
  assert.equal(pctZero.value, null)
})

test("deny list: unknown identifiers, functions, and constructs", () => {
  for (const formula of [
    "teleport(as_is.visits)",
    "fetch(as_is.visits)",
    "while(true)",
    "globalThis.visits",
    "Date(as_is.visits)",
    "process.visits",
    "require(as_is.visits)",
    "as_is.teleport",
    "sum(as_is.visits) + nope",
  ]) {
    assert.throws(() => evaluateFormula(formula, context(), MEASURES), CostError, formula)
  }
})

test("node limit rejects runaway formulas", () => {
  const formula = Array.from({ length: 120 }, (_, index) => `${index + 1}`).join(" + ")
  assert.throws(() => evaluateFormula(formula, context(), MEASURES), CostError)
})

test("results round to 4dp", () => {
  const result = evaluateFormula("10 / 3", { as_is: {}, tobe: {} }, MEASURES)
  assert.equal(result.value, 3.3333)
})

test("measure extraction parses units deterministically", () => {
  assert.equal(measureValue({ time: "4 days", cost: null, visits: null }, "time_to_decision"), 4)
  assert.ok(Math.abs(measureValue({ time: "15 min", cost: null, visits: null }, "time_to_decision") - 15 / 1440) < 1e-12)
  assert.equal(measureValue({ time: "3-hr round trip", cost: null, visits: null }, "time_to_decision"), 3 / 24)
  assert.equal(measureValue({ time: "~6 weeks", cost: null, visits: null }, "time_to_decision"), 6 * 7)
  assert.equal(measureValue({ time: null, cost: "300 taka", visits: null }, "out_of_pocket"), 300)
  assert.equal(measureValue({ time: null, cost: null, visits: "Up to 3" }, "visits"), 3)
  assert.equal(measureValue({ time: null, cost: null, visits: null }, "visits"), 0)
  assert.equal(measureValue({ time: null, cost: null, visits: null }, "steps"), 1)
})

test("projector diffs before and after elimination", () => {
  const steps = [
    { time: "4 days", cost: null, visits: "3" },
    { time: "3 hours", cost: null, visits: "1" },
    { time: "15 min", cost: null, visits: null },
  ]
  const projected = projectCosts(steps, new Set(["s1"]), ["s1", "s2", "s3"])
  const visits = projected.find((row) => row.measure === "visits")
  assert.equal(visits?.before, 4)
  assert.equal(visits?.after, 1)
  assert.equal(visits?.delta, 3)
  assert.equal(visits?.pct, 75)
  const count = projected.find((row) => row.measure === "steps")
  assert.equal(count?.before, 3)
  assert.equal(count?.after, 2)
})
