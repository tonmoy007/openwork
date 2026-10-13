/**
 * Cost sandbox (§13C): pure template formulas over declared step measures.
 * Allowlist: arithmetic, sum/min/max/avg/round/ceil/floor/abs/pct/if and
 * scalar comparisons. Everything else — loops, recursion, I/O, dates,
 * networks, globals — is rejected at parse time. Deterministic: same
 * template version + inputs always produce the same outputs. Limits: 200
 * AST nodes, 50ms evaluation, 4dp rounding at measure level. Division by
 * zero yields null with a warning instead of throwing into the funnel.
 */

export interface CostLists {
  as_is: Record<string, number[]>
  tobe: Record<string, number[]>
}

export interface CostResult {
  value: number | null
  warnings: string[]
}

export class CostError extends Error {
  readonly formula: string
  readonly kind: "parse" | "deny" | "timeout" | "arity" | "type"
  constructor(formula: string, kind: CostError["kind"], message: string) {
    super(`${kind} in formula "${formula}": ${message}`)
    this.name = "CostError"
    this.formula = formula
    this.kind = kind
  }
}

const MAX_NODES = 200
const MAX_MS = 50

type Scalar = number
type Vector = number[]
type Value = Scalar | Vector

type Node =
  | { kind: "number"; value: number }
  | { kind: "field"; stage: "as_is" | "tobe"; measure: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "==" | "!=" | "<" | "<=" | ">" | ">="; left: Node; right: Node }

const SCALAR_FUNCTIONS = new Set(["round", "ceil", "floor", "abs", "pct"])
const LIST_FUNCTIONS = new Set(["sum", "min", "max", "avg"])

function tokenize(formula: string): string[] {
  const tokens: string[] = []
  const pattern = /\s*([A-Za-z_][A-Za-z0-9_.]*|\d+(?:\.\d+)?|[+\-*/(),]|==|!=|<=|>=|<|>)\s*/gy
  let position = 0
  while (position < formula.length) {
    pattern.lastIndex = position
    const match = pattern.exec(formula)
    if (!match || match.index !== position) {
      throw new CostError(formula, "parse", `unexpected character at offset ${position}`)
    }
    tokens.push(match[1])
    position += match[0].length
  }
  return tokens
}

class Parser {
  private position = 0
  private nodes = 0
  private readonly formula: string
  private readonly tokens: string[]
  private readonly measures: Set<string>

  constructor(formula: string, tokens: string[], measures: Set<string>) {
    this.formula = formula
    this.tokens = tokens
    this.measures = measures
  }

  private count(): void {
    this.nodes += 1
    if (this.nodes > MAX_NODES) {
      throw new CostError(this.formula, "parse", `exceeds ${MAX_NODES} AST nodes`)
    }
  }

  private peek(): string | undefined {
    return this.tokens[this.position]
  }

  private consume(expected?: string): string {
    const token = this.tokens[this.position]
    if (token === undefined) {
      throw new CostError(this.formula, "parse", "unexpected end of formula")
    }
    if (expected !== undefined && token !== expected) {
      throw new CostError(this.formula, "parse", `expected "${expected}" but found "${token}"`)
    }
    this.position += 1
    return token
  }

  parse(): Node {
    const node = this.parseComparison()
    if (this.position < this.tokens.length) {
      throw new CostError(this.formula, "parse", `trailing input "${this.tokens.slice(this.position).join(" ")}"`)
    }
    return node
  }

  private parseComparison(): Node {
    this.count()
    let left = this.parseAdditive()
    for (;;) {
      const token = this.peek()
      if (token !== "==" && token !== "!=" && token !== "<" && token !== "<=" && token !== ">" && token !== ">=") {
        return left
      }
      this.consume()
      const right = this.parseAdditive()
      left = { kind: "binary", op: token, left, right }
    }
  }

  private parseAdditive(): Node {
    this.count()
    let left = this.parseMultiplicative()
    for (;;) {
      const token = this.peek()
      if (token !== "+" && token !== "-") return left
      this.consume()
      const right = this.parseMultiplicative()
      left = { kind: "binary", op: token, left, right }
    }
  }

  private parseMultiplicative(): Node {
    this.count()
    let left = this.parsePrimary()
    for (;;) {
      const token = this.peek()
      if (token !== "*" && token !== "/") return left
      this.consume()
      const right = this.parsePrimary()
      left = { kind: "binary", op: token, left, right }
    }
  }

  private parsePrimary(): Node {
    this.count()
    const token = this.peek()
    if (token === undefined) {
      throw new CostError(this.formula, "parse", "unexpected end of formula")
    }
    if (token === "(") {
      this.consume("(")
      const node = this.parseComparison()
      this.consume(")")
      return node
    }
    if (/^\d/.test(token)) {
      this.consume()
      return { kind: "number", value: Number(token) }
    }
    if (/^[A-Za-z_]/.test(token)) {
      return this.parseWord()
    }
    throw new CostError(this.formula, "parse", `unexpected token "${token}"`)
  }

  private parseWord(): Node {
    this.count()
    const word = this.consume()
    if (this.peek() === "(") {
      this.consume("(")
      const args: Node[] = []
      if (this.peek() !== ")") {
        args.push(this.parseComparison())
        while (this.peek() === ",") {
          this.consume(",")
          args.push(this.parseComparison())
        }
      }
      this.consume(")")
      this.checkCall(word, args.length)
      return { kind: "call", name: word, args }
    }
    const [stage, measure] = word.split(".")
    if ((stage === "as_is" || stage === "tobe") && measure) {
      if (!this.measures.has(measure)) {
        throw new CostError(this.formula, "deny", `undeclared measure "${measure}"`)
      }
      return { kind: "field", stage, measure }
    }
    throw new CostError(this.formula, "deny", `unknown identifier "${word}"`)
  }

  private checkCall(name: string, arity: number): void {
    if (name === "if") {
      if (arity !== 3) throw new CostError(this.formula, "arity", `"if" needs 3 arguments, got ${arity}`)
      return
    }
    if (LIST_FUNCTIONS.has(name)) {
      if (arity < 1) throw new CostError(this.formula, "arity", `"${name}" needs at least 1 argument`)
      return
    }
    if (SCALAR_FUNCTIONS.has(name)) {
      const expected = name === "pct" ? 2 : 1
      if (arity !== expected) {
        throw new CostError(this.formula, "arity", `"${name}" needs ${expected} arguments, got ${arity}`)
      }
      return
    }
    throw new CostError(this.formula, "deny", `unknown function "${name}"`)
  }
}

function asScalar(value: Value, formula: string, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CostError(formula, "type", `${what} needs a finite scalar`)
  }
  return value
}

function asVector(value: Value, formula: string, what: string): number[] {
  if (!Array.isArray(value)) {
    throw new CostError(formula, "type", `${what} needs a measure list`)
  }
  return value
}

export function evaluateFormula(
  formula: string,
  context: CostLists,
  measures: Set<string>,
  startedAt = Date.now(),
): CostResult {
  const warnings: string[] = []
  const checkDeadline = () => {
    if (Date.now() - startedAt > MAX_MS) {
      throw new CostError(formula, "timeout", `exceeds ${MAX_MS}ms`)
    }
  }

  function evaluate(node: Node): Value {
    checkDeadline()
    switch (node.kind) {
      case "number":
        return node.value
      case "field": {
        const lists = node.stage === "as_is" ? context.as_is : context.tobe
        return lists[node.measure] ?? []
      }
      case "binary": {
        const left = asScalar(evaluate(node.left), formula, `left of "${node.op}"`)
        const right = asScalar(evaluate(node.right), formula, `right of "${node.op}"`)
        switch (node.op) {
          case "+":
            return left + right
          case "-":
            return left - right
          case "*":
            return left * right
          case "/":
            if (right === 0) {
              warnings.push("division by zero — treated as unknown")
              return NaN
            }
            return left / right
          case "==":
            return left === right ? 1 : 0
          case "!=":
            return left !== right ? 1 : 0
          case "<":
            return left < right ? 1 : 0
          case "<=":
            return left <= right ? 1 : 0
          case ">":
            return left > right ? 1 : 0
          case ">=":
            return left >= right ? 1 : 0
        }
        break
      }
      case "call": {
        const args = node.args.map(evaluate)
        switch (node.name) {
          case "sum":
            return args.flatMap((arg) => asVector(arg, formula, "sum")).reduce((a, b) => a + b, 0)
          case "min":
            return Math.min(...args.flatMap((arg) => asVector(arg, formula, "min")))
          case "max":
            return Math.max(...args.flatMap((arg) => asVector(arg, formula, "max")))
          case "avg": {
            const values = args.flatMap((arg) => asVector(arg, formula, "avg"))
            return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
          }
          case "round":
            return Math.round(asScalar(args[0], formula, "round"))
          case "ceil":
            return Math.ceil(asScalar(args[0], formula, "ceil"))
          case "floor":
            return Math.floor(asScalar(args[0], formula, "floor"))
          case "abs":
            return Math.abs(asScalar(args[0], formula, "abs"))
          case "pct": {
            const before = asScalar(args[0], formula, "pct")
            const after = asScalar(args[1], formula, "pct")
            if (before === 0) {
              warnings.push("pct of zero baseline — treated as unknown")
              return NaN
            }
            return ((before - after) / before) * 100
          }
          case "if":
            return asScalar(args[0], formula, "if") !== 0 ? args[1] : args[2]
        }
        break
      }
    }
    throw new CostError(formula, "type", "could not evaluate node")
  }

  const parser = new Parser(formula, tokenize(formula), measures)
  const raw = evaluate(parser.parse())
  if (Array.isArray(raw)) {
    throw new CostError(formula, "type", "formula must reduce to a scalar")
  }
  if (Number.isNaN(raw)) return { value: null, warnings }
  return { value: Math.round(raw * 10000) / 10000, warnings }
}

const TIME_TO_DAYS: Array<[RegExp, number]> = [
  [/min/i, 1 / 1440],
  [/hour|hr/i, 1 / 24],
  [/week/i, 7],
  [/day/i, 1],
]

function firstNumber(text: string): number | null {
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

/**
 * Deterministic step-field extraction for the four P0 measures.
 * Time normalizes to days; anything unparseable counts as 0 and the
 * caller sees the same number every run. Documented, not clever.
 */
export function measureValue(
  step: { time: string | null; cost: string | null; visits: string | null },
  measure: string,
): number {
  if (measure === "steps") return 1
  const text =
    measure === "time_to_decision"
      ? step.time
      : measure === "out_of_pocket"
        ? step.cost
        : measure === "visits"
          ? step.visits
          : null
  if (!text) return 0
  const value = firstNumber(text)
  if (value === null) return 0
  if (measure === "time_to_decision") {
    for (const [pattern, factor] of TIME_TO_DAYS) {
      if (pattern.test(text)) return value * factor
    }
  }
  return value
}

export interface ProjectedMeasure {
  measure: string
  before: number
  after: number
  delta: number
  pct: number | null
  warnings: string[]
}

export function projectCosts(
  steps: Array<{ time: string | null; cost: string | null; visits: string | null }>,
  eliminatedIds: Set<string>,
  stepIds: string[],
  measures = ["visits", "time_to_decision", "out_of_pocket", "steps"],
): ProjectedMeasure[] {
  const beforeLists: Record<string, number[]> = {}
  const afterLists: Record<string, number[]> = {}
  steps.forEach((step, index) => {
    for (const measure of measures) {
      const value = measureValue(step, measure)
      ;(beforeLists[measure] ??= []).push(value)
      if (!eliminatedIds.has(stepIds[index])) {
        ;(afterLists[measure] ??= []).push(value)
      }
    }
  })
  const declared = new Set(measures)
  return measures.map((measure) => {
    const before = evaluateFormula(`sum(as_is.${measure})`, { as_is: beforeLists, tobe: afterLists }, declared)
    const after = evaluateFormula(`sum(tobe.${measure})`, { as_is: beforeLists, tobe: afterLists }, declared)
    const pct = evaluateFormula(`pct(sum(as_is.${measure}), sum(tobe.${measure}))`, { as_is: beforeLists, tobe: afterLists }, declared)
    const warnings = [...before.warnings, ...after.warnings, ...pct.warnings]
    return {
      measure,
      before: before.value ?? 0,
      after: after.value ?? 0,
      delta: (before.value ?? 0) - (after.value ?? 0),
      pct: pct.value,
      warnings: [...new Set(warnings)],
    }
  })
}
