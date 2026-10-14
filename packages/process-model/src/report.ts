/**
 * HTML-canonical export documents (print-CSS; PDF is a headless-Chrome
 * print sidecar, never a separate pipeline). Both builders render from the
 * same artifact store the UI uses, with template/version/run stamps so a
 * variant always reproduces from its snapshot hash.
 */
import type { ProjectedMeasure } from "@openwork/process-model/cost"

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const STYLE = `<style>
body{font-family:system-ui,sans-serif;max-width:860px;margin:0 auto;padding:32px;color:#111827;line-height:1.55}
h1{font-size:22px;letter-spacing:-.3px}h2{font-size:16px;margin-top:28px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;padding:8px;border-bottom:2px solid #e5e7eb}
td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}
.meta{color:#6b7280;font-size:12px}.foot{margin-top:32px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:12px;color:#6b7280}
@media print{body{padding:0}}
</style>`

export interface ReportStep {
  n: number
  label: string
  actor: string
  decision: string
  reason: string
  sources: string[]
}

export interface ReportInput {
  projectName: string
  template_ref: string
  snapshot_id: string
  runStamp: string
  steps: ReportStep[]
  constraints: Array<{ statement: string; reason: string }>
  costs: ProjectedMeasure[]
}

export function buildSimplificationReport(input: ReportInput): string {
  const stepRows = input.steps
    .map(
      (step) =>
        `<tr><td>${step.n}</td><td><strong>${escapeHtml(step.label)}</strong></td><td>${escapeHtml(step.actor)}</td><td>${escapeHtml(step.decision)}</td><td>${escapeHtml(step.reason)}</td><td>${step.sources.map(escapeHtml).join("<br>")}</td></tr>`,
    )
    .join("")
  const constraintRows = input.constraints
    .map(
      (constraint) =>
        `<tr><td>${escapeHtml(constraint.statement)}</td><td>${escapeHtml(constraint.reason)}</td></tr>`,
    )
    .join("")
  const costRows = input.costs
    .map(
      (cost) =>
        `<tr><td>${escapeHtml(cost.measure.replaceAll("_", " "))}</td><td>${cost.before}</td><td>${cost.after}</td><td>${cost.pct === null ? "unknown" : `${Math.round(cost.pct)}%`}</td></tr>`,
    )
    .join("")
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Simplification Report — ${escapeHtml(input.projectName)}</title>${STYLE}</head><body>
<h1>Simplification Report — ${escapeHtml(input.projectName)}</h1>
<p class="meta">Template ${escapeHtml(input.template_ref)} · snapshot ${escapeHtml(input.snapshot_id)} · ${escapeHtml(input.runStamp)}</p>
<h2>Decisions by step</h2>
<table><thead><tr><th>#</th><th>Step</th><th>Owner</th><th>Decision</th><th>Reason</th><th>Sources</th></tr></thead><tbody>${stepRows}</tbody></table>
<h2>Constraints</h2>
<table><thead><tr><th>Must stay</th><th>Why</th></tr></thead><tbody>${constraintRows}</tbody></table>
<h2>Projected impact</h2>
<table><thead><tr><th>Measure</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${costRows}</tbody></table>
<p class="foot">Generated from the project knowledge artifact store. Every claim above cites its evidence file and page.</p>
</body></html>`
}

export function buildDecisionRecord(input: ReportInput): string {
  const rows = input.steps
    .map(
      (step) =>
        `<tr><td>${step.n}</td><td><strong>${escapeHtml(step.label)}</strong></td><td>${escapeHtml(step.decision)}</td><td>${escapeHtml(step.reason)}</td></tr>`,
    )
    .join("")
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Decision Record — ${escapeHtml(input.projectName)}</title>${STYLE}</head><body>
<h1>Decision Record — ${escapeHtml(input.projectName)}</h1>
<p class="meta">Template ${escapeHtml(input.template_ref)} · snapshot ${escapeHtml(input.snapshot_id)} · ${escapeHtml(input.runStamp)}</p>
<table><thead><tr><th>#</th><th>Step</th><th>Decision</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>
<p class="foot">Append-only history: revisions link their parents in the stored snapshots.</p>
</body></html>`
}
