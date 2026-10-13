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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useBootState } from "@/react-app/shell/boot-state";
import { researchAsisRoute } from "./research-routes";
import { useResearchClient } from "./use-research-client";

const CRITERIA = [
  { id: "eliminate", label: "Eliminate — remove this step entirely" },
  { id: "combine", label: "Combine — merge with another step" },
  { id: "rearrange", label: "Rearrange — change the order" },
  { id: "simplify", label: "Simplify — make this step easier" },
  { id: "keep", label: "Keep — required as is" },
];

function criterionLabel(id: string): string {
  return CRITERIA.find((criterion) => criterion.id === id)?.label ?? id;
}

export function ResearchSimplifyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projectId = "" } = useParams();
  const { client, status } = useResearchClient();
  const { markRouteReady } = useBootState();
  const [statement, setStatement] = useState("");
  const [reason, setReason] = useState("");
  const [constraintError, setConstraintError] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [reviseText, setReviseText] = useState("");
  const [reviseReason, setReviseReason] = useState("");
  const [authorCriterion, setAuthorCriterion] = useState(CRITERIA[0].id);
  const [authorProposal, setAuthorProposal] = useState("");
  const [authorReason, setAuthorReason] = useState("");

  const processing = useQuery({
    queryKey: ["research", "processing", projectId],
    queryFn: () => client!.getProcessing(projectId),
    enabled: client !== null && projectId !== "",
  });

  useEffect(() => {
    if (status !== "connecting" && !processing.isPending) markRouteReady();
  }, [status, processing.isPending, markRouteReady]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["research", "processing", projectId] });

  const saveConstraint = useMutation({
    mutationFn: () =>
      client!.addConstraint(projectId, { statement: statement.trim(), reason: reason.trim(), claim_ids: [] }),
    onSuccess: () => {
      setStatement("");
      setReason("");
      setConstraintError(null);
      invalidate();
    },
    onError: (cause) => setConstraintError(cause instanceof Error ? cause.message : "Could not save the constraint."),
  });

  const propose = useMutation({
    mutationFn: () => client!.proposeSimplifications(projectId),
    onSuccess: () => {
      setProposeError(null);
      invalidate();
    },
    onError: (cause) => setProposeError(cause instanceof Error ? cause.message : "Proposals did not finish."),
  });

  const decide = useMutation({
    mutationFn: (input: { stepId: string; state: string; proposal?: string; reason?: string; criterion_id?: string; action?: string }) =>
      client!.decideSimplification(projectId, input.stepId, input),
    onSuccess: () => {
      setOpenStep(null);
      setReviseText("");
      setReviseReason("");
      setAuthorProposal("");
      setAuthorReason("");
      invalidate();
    },
  });

  if (status !== "ready" || processing.isPending) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (processing.isError) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Simplification did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void processing.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { model, undecided, constraints } = processing.data;
  const decidedCount = (model?.steps.length ?? 0) - undecided.length;

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Simplification</h1>
        <p className="text-sm text-muted-foreground">
          Say what must stay, then decide every proposed change step by step.
        </p>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>What must stay, and why</CardTitle>
          <CardDescription>
            {constraints.length === 0
              ? "Name the first non-negotiable before proposals can run."
              : `${constraints.length} constraint${constraints.length === 1 ? "" : "s"} recorded.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {constraints.map((constraint) => (
            <div key={constraint.constraint_id} className="rounded-md border px-3 py-2">
              <p className="text-sm font-medium">{constraint.statement}</p>
              <p className="text-xs text-muted-foreground">{constraint.reason}</p>
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="constraint-statement">Constraint</Label>
            <Input
              id="constraint-statement"
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              placeholder="The officer decision stays."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="constraint-reason">Why</Label>
            <Textarea
              id="constraint-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Labour Welfare Act s.14 names the decider."
              rows={2}
            />
          </div>
          {constraintError ? <p className="text-sm text-destructive">{constraintError}</p> : null}
          <div>
            <Button
              size="sm"
              disabled={saveConstraint.isPending || statement.trim().length === 0 || reason.trim().length === 0}
              onClick={() => saveConstraint.mutate()}
            >
              {saveConstraint.isPending ? "Saving…" : "Save constraint"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!model ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>No proposals yet</CardTitle>
            <CardDescription>Proposals read every constraint above.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {proposeError ? <p className="text-sm text-destructive">{proposeError}</p> : null}
            <div>
              <Button disabled={propose.isPending} onClick={() => propose.mutate()}>
                {propose.isPending ? "Proposing…" : "Propose changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>
              Proposed changes · {decidedCount} of {model.steps.length} decided
            </CardTitle>
            <CardDescription>Accept, reject, or revise each proposal with its reason on file.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-0">
            {model.steps.map((step, index) => {
              const simplification = step.simplification;
              return (
                <div key={step.id} className="border-b px-4 py-3 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {index + 1}. {step.label}
                      </p>
                      {simplification ? (
                        <p className="mt-1 text-sm">
                          <span className="font-medium">{criterionLabel(simplification.criterion_id)}:</span>{" "}
                          {simplification.proposal}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">
                          No proposal yet — write one below.
                        </p>
                      )}
                      {simplification && simplification.state !== "proposed" ? (
                        <p className="mt-1">
                          <Badge variant={simplification.state === "accepted" ? "default" : "secondary"}>
                            {simplification.state}
                          </Badge>
                        </p>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setOpenStep(openStep === step.id ? null : step.id);
                        setReviseText(simplification?.proposal ?? "");
                        setReviseReason("");
                      }}
                    >
                      {openStep === step.id ? "Close" : "Decide"}
                    </Button>
                  </div>
                  {openStep === step.id ? (
                    <div className="mt-3 flex flex-col gap-3 rounded-md border p-3">
                      {simplification ? (
                        <>
                          <p className="text-xs text-muted-foreground">{simplification.reason}</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={decide.isPending}
                              onClick={() => decide.mutate({ stepId: step.id, state: "accepted" })}
                            >
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={decide.isPending}
                              onClick={() => decide.mutate({ stepId: step.id, state: "rejected", reason: "Not right for this service." })}
                            >
                              Reject
                            </Button>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`revise-${step.id}`}>Or revise the proposal</Label>
                            <Textarea
                              id={`revise-${step.id}`}
                              value={reviseText}
                              onChange={(event) => setReviseText(event.target.value)}
                              rows={2}
                            />
                            <Input
                              id={`revise-reason-${step.id}`}
                              value={reviseReason}
                              onChange={(event) => setReviseReason(event.target.value)}
                              placeholder="Why is the revision better?"
                            />
                            <div>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={decide.isPending || reviseText.trim().length === 0 || reviseReason.trim().length === 0}
                                onClick={() =>
                                  decide.mutate({
                                    stepId: step.id,
                                    state: "revised",
                                    proposal: reviseText.trim(),
                                    reason: reviseReason.trim(),
                                  })
                                }
                              >
                                Save revision
                              </Button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <Label>Criterion</Label>
                            <div className="flex flex-wrap gap-2">
                              {CRITERIA.map((criterion) => (
                                <Button
                                  key={criterion.id}
                                  size="sm"
                                  variant={authorCriterion === criterion.id ? "default" : "outline"}
                                  onClick={() => setAuthorCriterion(criterion.id)}
                                >
                                  {criterion.id}
                                </Button>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`author-proposal-${step.id}`}>Proposal</Label>
                            <Textarea
                              id={`author-proposal-${step.id}`}
                              value={authorProposal}
                              onChange={(event) => setAuthorProposal(event.target.value)}
                              rows={2}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`author-reason-${step.id}`}>Reason</Label>
                            <Input
                              id={`author-reason-${step.id}`}
                              value={authorReason}
                              onChange={(event) => setAuthorReason(event.target.value)}
                            />
                          </div>
                          <div>
                            <Button
                              size="sm"
                              disabled={decide.isPending || authorProposal.trim().length === 0 || authorReason.trim().length === 0}
                              onClick={() =>
                                decide.mutate({
                                  stepId: step.id,
                                  state: "accepted",
                                  criterion_id: authorCriterion,
                                  action: authorCriterion,
                                  proposal: authorProposal.trim(),
                                  reason: authorReason.trim(),
                                })
                              }
                            >
                              Save decision
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Agent questions</CardTitle>
          <CardDescription>
            Clarifying questions appear here once model sessions land. Nothing needs you yet.
          </CardDescription>
        </CardHeader>
      </Card>

      {model && undecided.length === 0 ? (
        <Alert className="mb-4">
          <AlertTitle>All steps decided</AlertTitle>
          <AlertDescription>
            Every proposal has a verdict with reasons on file. Cost projection and the to-be workspace arrive next.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={() => navigate(researchAsisRoute(projectId))}>
          Back to as-is
        </Button>
      </div>
    </div>
  );
}
