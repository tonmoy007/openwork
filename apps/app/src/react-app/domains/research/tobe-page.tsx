/** @jsxImportSource react */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { projectCosts } from "@openwork/process-model/cost";
import { useBootState } from "@/react-app/shell/boot-state";
import { researchSimplifyRoute } from "./research-routes";
import { ResearchBack } from "./page-shell";
import { useResearchClient } from "./use-research-client";

function formatMeasure(value: number, measure: string): string {
  if (measure === "time_to_decision") return `${Math.round(value * 10) / 10} days`;
  if (measure === "out_of_pocket") return `${Math.round(value)} taka`;
  return `${Math.round(value * 10) / 10}`;
}

export function ResearchTobePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projectId = "" } = useParams();
  const { client, status } = useResearchClient();
  const { markRouteReady } = useBootState();

  const tobe = useQuery({
    queryKey: ["research", "tobe", projectId],
    queryFn: () => client!.getTobe(projectId),
    enabled: client !== null && projectId !== "",
  });
  const processing = useQuery({
    queryKey: ["research", "processing", projectId],
    queryFn: () => client!.getProcessing(projectId),
    enabled: client !== null && projectId !== "",
  });

  useEffect(() => {
    if (status !== "connecting" && !tobe.isPending) markRouteReady();
  }, [status, tobe.isPending, markRouteReady]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["research", "tobe", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["research", "processing", projectId] });
  };

  const build = useMutation({
    mutationFn: () => client!.buildTobe(projectId),
    onSuccess: invalidate,
  });
  const approve = useMutation({
    mutationFn: () => client!.approveTobe(projectId),
    onSuccess: invalidate,
    onError: () => undefined,
  });
  const approved = approve.data?.phase === "approved";

  const manifest = useQuery({
    queryKey: ["research", "export", projectId],
    queryFn: () => client!.listExportFiles(projectId),
    enabled: client !== null && projectId !== "" && approved,
  });

  function download(endpoint: string) {
    if (!client) return;
    void client
      .downloadExportFile(projectId, endpoint)
      .then(({ bytes, contentType, filename }) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.style.display = "none";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
      })
      .catch(() => undefined);
  }

  if (status !== "ready" || tobe.isPending || processing.isPending) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (tobe.isError || processing.isError) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>To-be did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => {
                void tobe.refetch();
                void processing.refetch();
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const variant = tobe.data.variant;
  const processingModel = processing.data.model;
  const impacts =
    processingModel && variant
      ? projectCosts(
          processingModel.steps,
          new Set(
            processingModel.steps
              .filter(
                (step) =>
                  step.simplification?.state === "accepted" &&
                  step.simplification.action === "eliminate",
              )
              .map((step) => step.id),
          ),
          processingModel.steps.map((step) => step.id),
        )
      : [];

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6 flex items-start gap-2">
        <ResearchBack to={researchSimplifyRoute(projectId)} label="simplification" />
        <div>
        <h1 className="text-xl font-semibold tracking-tight">To-be process</h1>
        <p className="text-sm text-muted-foreground">
          The simplified journey, built only from decided steps.
        </p>
        </div>
      </div>

      {!variant ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>No variant yet</CardTitle>
            <CardDescription>Building needs every simplification decided.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled={build.isPending} onClick={() => build.mutate()}>
              {build.isPending ? "Building…" : "Build to-be variant"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Before · as-is decisions</CardTitle>
                <CardDescription>{processingModel?.steps.length ?? 0} steps reviewed</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {(processingModel?.steps ?? []).map((step, index) => (
                  <div key={step.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">
                      {index + 1}. {step.label}
                    </span>
                    <Badge variant="outline">{step.simplification?.action ?? "undecided"}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>After · {variant.label}</CardTitle>
                <CardDescription>{variant.steps.length} steps remain</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {variant.steps.map((step, index) => (
                  <div key={step.id} className="text-sm">
                    <p className="font-medium">
                      {index + 1}. {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {step.actor} · {step.origin === "changed" ? "changed by revision" : "kept as is"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Projected impact</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {impacts.map((impact) => (
                  <div key={impact.measure} className="rounded-md border px-3 py-2 text-center">
                    <p className="text-lg font-bold">
                      {impact.pct === null ? "—" : `${Math.round(impact.pct)}% less`}
                    </p>
                    <p className="text-xs text-muted-foreground">{impact.measure.replaceAll("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatMeasure(impact.before, impact.measure)} → {formatMeasure(impact.after, impact.measure)}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Ask the agent</CardTitle>
              <CardDescription>
                Challenges and alternative routes appear here once model sessions land. Nothing needs you yet.
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="flex items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => navigate(researchSimplifyRoute(projectId))}>
              Back to simplification
            </Button>
            <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? "Approving…" : "Approve to-be"}
            </Button>
          </div>
          {approve.isError ? (
            <p className="mt-3 text-sm text-destructive">
              Only a reviewer can approve. On solo projects the researcher approves.
            </p>
          ) : null}
          {approve.data?.phase === "approved" ? (
            <Alert className="mt-4">
              <AlertTitle>To-be approved</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <span>Saved to project knowledge with the decision record.</span>
                {manifest.data ? (
                  <span className="flex flex-col gap-2">
                    {manifest.data.map((file) => (
                      <span key={file.sha256} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{file.name}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            sha256 {file.sha256.slice(0, 16)}… · {file.size} bytes
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            download(
                              file.kind === "xlsx"
                                ? "decisions.xlsx"
                                : file.kind === "report"
                                  ? "report.html"
                                  : file.kind === "decision"
                                    ? "decision.html"
                                    : file.name.includes("-ASIS.")
                                      ? "asis.bpmn"
                                      : "tobe.bpmn",
                            )
                          }
                        >
                          Download
                        </Button>
                      </span>
                    ))}
                  </span>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}
    </div>
  );
}
