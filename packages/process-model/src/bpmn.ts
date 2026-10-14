/**
 * BPMN 2.0 codec with `sps:*` annotations. Export renders lanes, tasks,
 * start/end events, and sequence flows as strict BPMN 2.0; pains and
 * decisions ride in `bpmn:extensionElements` under
 * `xmlns:sps="https://openworklabs.com/bpmn/sps"` so external tools ignore
 * them. Import accepts plain BPMN 2.0 (painless steps) and preserves
 * unknown `sps:*` versions on re-export. Malformed input fails with a
 * lane/step pointer, never a bare stack.
 */
import { XMLParser } from "fast-xml-parser"
import type { ProcessModel } from "@openwork/process-model/model"

export const SPS_NAMESPACE = "https://openworklabs.com/bpmn/sps"

export class BpmnError extends Error {
  readonly pointer: string
  constructor(pointer: string, message: string) {
    super(`${pointer}: ${message}`)
    this.name = "BpmnError"
    this.pointer = pointer
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function modelToXml(model: ProcessModel): string {
  const lanes = model.lanes
    .map(
      (lane) =>
        `    <bpmn:lane id="${lane.id}" name="${escapeXml(lane.label)}">\n` +
        lane.step_ids.map((step_id) => `      <bpmn:flowNodeRef>${step_id}</bpmn:flowNodeRef>\n`).join("") +
        `    </bpmn:lane>`,
    )
    .join("\n")
  const tasks = model.steps
    .map((step) => {
      const extensions: string[] = []
      for (const pain of step.pains) {
        extensions.push(
          `      <sps:pain dimension="${escapeXml(pain.dimension)}" severity="${escapeXml(pain.severity)}" sources="${escapeXml(pain.claim_ids.join(","))}">${escapeXml(pain.finding)}</sps:pain>`,
        )
      }
      const simplification = step.simplification
      if (simplification) {
        extensions.push(
          `      <sps:decision criterion="${escapeXml(simplification.criterion_id)}" state="${escapeXml(simplification.state)}" sources="${escapeXml(simplification.claim_ids.join(","))}">${escapeXml(simplification.proposal)}</sps:decision>`,
        )
      }
      const extensionBlock =
        extensions.length > 0
          ? `      <bpmn:extensionElements>\n${extensions.join("\n")}\n      </bpmn:extensionElements>\n`
          : ""
      return (
        `    <bpmn:task id="${step.id}" name="${escapeXml(step.label)}">\n` +
        extensionBlock +
        `    </bpmn:task>`
      )
    })
    .join("\n")
  const flows = model.edges
    .map(
      (edge, index) =>
        `    <bpmn:sequenceFlow id="flow-${index + 1}" sourceRef="${edge.from}" targetRef="${edge.to}" />`,
    )
    .join("\n")
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:sps="${SPS_NAMESPACE}" id="sps-definitions" targetNamespace="https://openworklabs.com/bpmn">\n` +
    `  <bpmn:process id="sps-process" isExecutable="false">\n` +
    `    <bpmn:laneSet>\n${lanes}\n    </bpmn:laneSet>\n` +
    `    <bpmn:startEvent id="start" />\n` +
    `${tasks}\n` +
    `${flows ? `${flows}\n` : ""}` +
    `    <bpmn:endEvent id="end" />\n` +
    `  </bpmn:process>\n` +
    `</bpmn:definitions>\n`
  )
}

interface ParsedTask {
  id: string
  label: string
  pains: Array<{ dimension: string; severity: string; finding: string; claim_ids: string[] }>
  decisions: Array<{ criterion: string; state: string; proposal: string; claim_ids: string[] }>
  spsUnknown: string[]
}

function taskList(value: unknown): Array<Record<string, unknown>> {
  if (typeof value === "string") return [{ "#text": value }]
  if (Array.isArray(value)) {
    return value.flatMap((item): Array<Record<string, unknown>> => {
      if (typeof item === "string") return [{ "#text": item }]
      if (typeof item === "object" && item !== null) return [item as Record<string, unknown>]
      return []
    })
  }
  if (typeof value === "object" && value !== null) return [value as Record<string, unknown>]
  return []
}

function attr(node: Record<string, unknown>, name: string): string {
  const value = node[`@_${name}`]
  return typeof value === "string" ? value : ""
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node
  if (typeof node === "object" && node !== null) {
    const text = (node as Record<string, unknown>)["#text"]
    return typeof text === "string" ? text : ""
  }
  return ""
}

function stringList(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean)
}

export interface ImportedModel {
  steps: Array<{ id: string; label: string; actor: string; pains: ParsedTask["pains"]; decisions: ParsedTask["decisions"]; spsUnknown: string[] }>
  lanes: Array<{ id: string; label: string; step_ids: string[] }>
  edges: Array<{ from: string; to: string }>
}

/** Render a to-be variant (kept/changed steps only) as plain BPMN 2.0. */
export function variantToXml(variant: {
  steps: Array<{ id: string; label: string; actor: string; origin: string }>
}): string {
  const actors = [...new Set(variant.steps.map((step) => step.actor))]
  const lanes = actors
    .map(
      (actor, index) =>
        `    <bpmn:lane id="lane-${index + 1}" name="${escapeXml(actor)}">\n` +
        variant.steps
          .filter((step) => step.actor === actor)
          .map((step) => `      <bpmn:flowNodeRef>${step.id}</bpmn:flowNodeRef>\n`)
          .join("") +
        `    </bpmn:lane>`,
    )
    .join("\n")
  const tasks = variant.steps
    .map(
      (step) =>
        `    <bpmn:task id="${step.id}" name="${escapeXml(step.label)}">\n` +
        `      <bpmn:extensionElements>\n` +
        `        <sps:origin>${escapeXml(step.origin)}</sps:origin>\n` +
        `      </bpmn:extensionElements>\n` +
        `    </bpmn:task>`,
    )
    .join("\n")
  const flows = variant.steps
    .slice(1)
    .map(
      (step, index) =>
        `    <bpmn:sequenceFlow id="flow-${index + 1}" sourceRef="${variant.steps[index].id}" targetRef="${step.id}" />`,
    )
    .join("\n")
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:sps="${SPS_NAMESPACE}" id="sps-definitions" targetNamespace="https://openworklabs.com/bpmn">\n` +
    `  <bpmn:process id="sps-tobe-process" isExecutable="false">\n` +
    `    <bpmn:laneSet>\n${lanes}\n    </bpmn:laneSet>\n` +
    `    <bpmn:startEvent id="start" />\n` +
    `${tasks}\n` +
    `${flows ? `${flows}\n` : ""}` +
    `    <bpmn:endEvent id="end" />\n` +
    `  </bpmn:process>\n` +
    `</bpmn:definitions>\n`
  )
}

/** Parse BPMN 2.0 (with or without `sps:*`) into an importable model. */
export function xmlToModel(xml: string): ImportedModel {
  let parsed: unknown
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) =>
        ["bpmn:lane", "bpmn:task", "bpmn:sequenceFlow", "bpmn:flowNodeRef", "sps:pain", "sps:decision"].includes(name),
    }).parse(xml)
  } catch (error) {
    throw new BpmnError("document", error instanceof Error ? error.message : "unparseable XML")
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new BpmnError("document", "not a BPMN document")
  }
  const definitions = (parsed as Record<string, unknown>)["bpmn:definitions"] as Record<string, unknown> | undefined
  if (!definitions) throw new BpmnError("document", "missing bpmn:definitions")
  const process = definitions["bpmn:process"] as Record<string, unknown> | undefined
  if (!process) throw new BpmnError("document", "missing bpmn:process")

  const laneSet = process["bpmn:laneSet"] as Record<string, unknown> | undefined
  const laneNodes = taskList(laneSet?.["bpmn:lane"])
  const lanes = laneNodes.map((lane, index) => {
    const refs = taskList(lane["bpmn:flowNodeRef"]).map((ref) => textOf(ref))
    if (refs.length === 0) {
      throw new BpmnError(`lane[${index}]`, "lane references no steps")
    }
    return { id: attr(lane, "id") || `lane-${index + 1}`, label: attr(lane, "name") || `Lane ${index + 1}`, step_ids: refs }
  })

  const tasks = taskList(process["bpmn:task"])
  if (tasks.length === 0) throw new BpmnError("process", "no bpmn:task elements found")
  const steps = tasks.map((task, index) => {
    const id = attr(task, "id")
    if (!id) throw new BpmnError(`task[${index}]`, "task without id")
    const extensions = task["bpmn:extensionElements"] as Record<string, unknown> | undefined
    const pains = taskList(extensions?.["sps:pain"]).map((pain) => ({
      dimension: attr(pain, "dimension") || "unknown",
      severity: attr(pain, "severity") || "medium",
      finding: textOf(pain),
      claim_ids: stringList(attr(pain, "sources")),
    }))
    const decisions = taskList(extensions?.["sps:decision"]).map((decision) => ({
      criterion: attr(decision, "criterion") || "unknown",
      state: attr(decision, "state") || "proposed",
      proposal: textOf(decision),
      claim_ids: stringList(attr(decision, "sources")),
    }))
    const known = new Set(["sps:pain", "sps:decision"])
    const spsUnknown = Object.keys(extensions ?? {}).filter((key) => key.startsWith("sps:") && !known.has(key))
    return { id, label: attr(task, "name") || id, actor: "Citizen", pains, decisions, spsUnknown }
  })

  const stepIds = new Set(steps.map((step) => step.id))
  for (const lane of lanes) {
    for (const step_id of lane.step_ids) {
      if (!stepIds.has(step_id)) {
        throw new BpmnError(`lane "${lane.id}"`, `references unknown step "${step_id}"`)
      }
    }
  }
  const edges = taskList(process["bpmn:sequenceFlow"]).map((flow, index) => {
    const from = attr(flow, "sourceRef")
    const to = attr(flow, "targetRef")
    if (!from || !to) throw new BpmnError(`flow[${index}]`, "sequence flow without sourceRef/targetRef")
    if (!stepIds.has(from) || !stepIds.has(to)) {
      throw new BpmnError(`flow[${index}]`, `references unknown step "${from}" → "${to}"`)
    }
    return { from, to }
  })
  return { steps, lanes, edges }
}
