/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { tableRows } from "@openwork/process-model/rows";
import type { AsisModel } from "@/app/lib/openwork-server";
import { useBootState } from "@/react-app/shell/boot-state";
import { researchPortfolioRoute, researchSimplifyRoute } from "./research-routes";
import { useResearchClient } from "./use-research-client";

const PAIN_DIMENSIONS = ["delay", "cost", "trips", "duplication", "legal_basis", "exclusion", "language_access", "rework"];
const SEVERITIES = ["low", "medium", "high"];

function StepBpmn({ model }: { model: AsisModel }) {
  const nodeWidth = 120;
  const nodeHeight = 64;
  const gap = 28;
  const laneHeight = 120;
  const pad = 16;
  const maxSteps = Math.max(...model.lanes.map((lane) => lane.step_ids.length), 1);
  const width = pad * 2 + 90 + maxSteps * (nodeWidth + gap);
  const height = pad * 2 + model.lanes.length * laneHeight;
  const byId = new Map(model.steps.map((step) => [step.id, step]));

  return (
    <div className="overflow-x-auto rounded-md border">
      <svg width={width} height={height} role="img" aria-label="As-is process diagram">
        {model.lanes.map((lane, laneIndex) => {
          const y = pad + laneIndex * laneHeight;
          return (
            <g key={lane.id}>
              <rect x={pad} y={y} width={width - pad * 2} height={laneHeight - 12} rx={8} className="fill-muted/40" />
              <text x={pad + 10} y={y + 20} fontSize={11} fontWeight={700} className="fill-muted-foreground">
                {lane.label}
              </text>
              {lane.step_ids.map((stepId, stepIndex) => {
                const step = byId.get(stepId);
                if (!step) return null;
                const x = pad + 90 + stepIndex * (nodeWidth + gap);
                const boxY = y + 36;
                const hasPain = step.pains.length > 0;
                const cleared = step.no_pain_reason !== null;
                const fill = hasPain ? "#fef3c7" : cleared ? "#d1fae5" : "#ffffff";
                const stroke = hasPain ? "#d97706" : cleared ? "#059669" : "#d1d5db";
                return (
                  <g key={stepId}>
                    {stepIndex > 0 ? (
                      <line
                        x1={x - gap}
                        y1={boxY + nodeHeight / 2}
                        x2={x}
                        y2={boxY + nodeHeight / 2}
                        stroke="#9ca3af"
                        strokeWidth={1.5}
                        markerEnd="url(#asis-arrow)"
                      />
                    ) : null}
                    <rect x={x} y={boxY} width={nodeWidth} height={nodeHeight} rx={8} fill={fill} stroke={stroke} strokeWidth={2} />
                    <text x={x + nodeWidth / 2} y={boxY + 26} textAnchor="middle" fontSize={11} fontWeight={600} fill="#111827">
                      {step.label.length > 18 ? `${step.label.slice(0, 17)}…` : step.label}
                    </text>
                    <text x={x + nodeWidth / 2} y={boxY + 44} textAnchor="middle" fontSize={10} fill="#6b7280">
                      {hasPain ? `${step.pains.length} pain${step.pains.length > 1 ? "s" : ""}` : cleared ? "All clear" : "No pains yet"}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <defs>
          <marker id="asis-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

function PainEditor({ projectId, stepId, claimOptions, onDone }: {
  projectId: string;
  stepId: string;
  claimOptions: Array<{ id: string; label: string }>;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { client } = useResearchClient();
  const [dimension, setDimension] = useState(PAIN_DIMENSIONS[0]);
  const [finding, setFinding] = useState("");
  const [severity, setSeverity] = useState(SEVERITIES[1]);
  const [checked, setChecked] = useState<string[]>(claimOptions.map((option) => option.id));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      client!.addAsisPain(projectId, stepId, {
        dimension,
        finding: finding.trim(),
        severity,
        claim_ids: checked,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["research", "asis", projectId] });
      onDone();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not save the pain."),
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Dimension</Label>
          <Select value={dimension} onValueChange={(value) => setDimension(value ?? PAIN_DIMENSIONS[0])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAIN_DIMENSIONS.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Severity</Label>
          <Select value={severity} onValueChange={(value) => setSeverity(value ?? SEVERITIES[1])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`pain-finding-${stepId}`}>Finding</Label>
        <Textarea
          id={`pain-finding-${stepId}`}
          value={finding}
          onChange={(event) => setFinding(event.target.value)}
          placeholder="What hurts, in one sentence…"
          rows={2}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Evidence</Label>
        {claimOptions.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked.includes(option.id)}
              onChange={(event) =>
                setChecked((current) =>
                  event.target.checked
                    ? [...current, option.id]
                    : current.filter((id) => id !== option.id),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={save.isPending || finding.trim().length === 0} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save pain"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export function ResearchAsisPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projectId = "" } = useParams();
  const { client, status } = useResearchClient();
  const { markRouteReady } = useBootState();
  const [view, setView] = useState<"table" | "bpmn">("table");
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [clearingStep, setClearingStep] = useState<string | null>(null);
  const [clearReason, setClearReason] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const asis = useQuery({
    queryKey: ["research", "asis", projectId],
    queryFn: () => client!.getAsis(projectId),
    enabled: client !== null && projectId !== "",
  });
  const evidence = useQuery({
    queryKey: ["research", "evidence", projectId],
    queryFn: () => client!.getResearchEvidence(projectId),
    enabled: client !== null && projectId !== "",
  });

  useEffect(() => {
    if (status !== "connecting" && !asis.isPending) markRouteReady();
  }, [status, asis.isPending, markRouteReady]);

  const draft = useMutation({
    mutationFn: () => client!.draftAsis(projectId),
    onSuccess: () => {
      setDraftError(null);
      void queryClient.invalidateQueries({ queryKey: ["research", "asis", projectId] });
    },
    onError: (cause) => setDraftError(cause instanceof Error ? cause.message : "Draft did not finish."),
  });
  const confirm = useMutation({
    mutationFn: () => client!.confirmAsis(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["research", "asis", projectId] });
    },
  });
  const clear = useMutation({
    mutationFn: ({ stepId, reason }: { stepId: string; reason: string }) =>
      client!.clearAsisStep(projectId, stepId, reason),
    onSuccess: () => {
      setClearingStep(null);
      setClearReason("");
      void queryClient.invalidateQueries({ queryKey: ["research", "asis", projectId] });
    },
  });

  if (status !== "ready" || asis.isPending) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (asis.isError) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>As-is did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void asis.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const model = asis.data.model;
  const confirmGate = asis.data.confirm;

  if (!model) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">As-is process</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Drafted from indexed evidence. Review every step before confirming.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>No draft yet</CardTitle>
            <CardDescription>Drafting reads every indexed evidence file once.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {draftError ? <p className="text-sm text-destructive">{draftError}</p> : null}
            <div>
              <Button disabled={draft.isPending} onClick={() => draft.mutate()}>
                {draft.isPending ? "Drafting…" : "Draft as-is from evidence"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const claimOptions = (evidence.data?.files ?? []).flatMap((file) =>
    file.claims.map((claim) => ({
      id: claim.claim_id,
      label: `${file.name} · p${claim.page} · ${claim.section}`,
      stepIds: model.steps.filter((step) => step.claim_ids.includes(claim.claim_id)).map((step) => step.id),
    })),
  );
  const claimFile = new Map(
    (evidence.data?.files ?? []).flatMap((file) =>
      file.claims.map((claim) => [claim.claim_id, { claim, file: file.name }] as const),
    ),
  );
  const rows = tableRows(
    { ...model, steps: model.steps.map((step) => ({ ...step, simplification: step.simplification ?? null })) },
    claimFile,
  );

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">As-is process</h1>
          <p className="text-sm text-muted-foreground">
            How the process runs today, with a pain or an all-clear on every step.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border p-1">
          <Button size="sm" variant={view === "table" ? "default" : "ghost"} onClick={() => setView("table")}>
            Table
          </Button>
          <Button size="sm" variant={view === "bpmn" ? "default" : "ghost"} onClick={() => setView("bpmn")}>
            Diagram
          </Button>
        </div>
      </div>

      {view === "bpmn" ? (
        <div className="mb-4"><StepBpmn model={model} /></div>
      ) : (
        <Card className="mb-4">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Step</th>
                  <th className="px-4 py-2">Owner</th>
                  <th className="px-4 py-2">State</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <>
                    <tr key={row.step_id} className="border-b last:border-0">
                      <td className="px-4 py-2 text-muted-foreground">{row.n}</td>
                      <td className="px-4 py-2">
                        <p className="font-medium">{row.step}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.claim_count} section{row.claim_count === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="px-4 py-2">{row.actor}</td>
                      <td className="px-4 py-2">
                        {row.type === "pain" ? (
                          <Badge variant="secondary">Pain noted</Badge>
                        ) : model.steps[row.n - 1]?.no_pain_reason ? (
                          <Badge variant="outline">All clear</Badge>
                        ) : (
                          <Badge variant="outline">Undecided</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenStep(openStep === row.step_id ? null : row.step_id)}
                        >
                          {openStep === row.step_id ? "Close" : "Decide"}
                        </Button>
                      </td>
                    </tr>
                    {openStep === row.step_id ? (
                      <tr key={`${row.step_id}-editor`}>
                        <td colSpan={5} className="bg-muted/40 px-4 py-3">
                          {rows[row.n - 1]?.detail ? (
                            <p className="mb-3 text-sm text-muted-foreground">{rows[row.n - 1].detail}</p>
                          ) : null}
                          {clearingStep === row.step_id ? (
                            <div className="flex flex-col gap-2">
                              <Label htmlFor={`clear-${row.step_id}`}>Why is this step fine as is?</Label>
                              <Input
                                id={`clear-${row.step_id}`}
                                value={clearReason}
                                onChange={(event) => setClearReason(event.target.value)}
                                placeholder="Core government work required by law…"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  disabled={clear.isPending || clearReason.trim().length === 0}
                                  onClick={() => clear.mutate({ stepId: row.step_id, reason: clearReason.trim() })}
                                >
                                  Mark all clear
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setClearingStep(null)}>
                                  Back
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3">
                              <PainEditor
                                projectId={projectId}
                                stepId={row.step_id}
                                claimOptions={claimOptions.filter((option) =>
                                  option.stepIds.includes(row.step_id),
                                )}
                                onDone={() => setOpenStep(null)}
                              />
                              <div>
                                <Button size="sm" variant="outline" onClick={() => setClearingStep(row.step_id)}>
                                  Mark all clear instead
                                </Button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {confirmGate.ready ? (
        <Alert className="mb-4">
          <AlertTitle>Ready to confirm</AlertTitle>
          <AlertDescription>{confirmGate.reasons[0]}</AlertDescription>
        </Alert>
      ) : (
        <Alert className="mb-4">
          <AlertTitle>Not ready yet</AlertTitle>
          <AlertDescription>{confirmGate.reasons.join(" ")}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={() => navigate(researchPortfolioRoute())}>
          Back to projects
        </Button>
        {confirm.data?.phase === "processing" ? (
          <Alert className="flex-1">
            <AlertTitle>As-is confirmed</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>Simplification starts from this snapshot.</span>
              <span>
                <Button size="sm" onClick={() => navigate(researchSimplifyRoute(projectId))}>
                  Open simplification
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        ) : (
          <Button
            disabled={!confirmGate.ready || confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? "Confirming…" : "Confirm as-is"}
          </Button>
        )}
      </div>
    </div>
  );
}
