/** @jsxImportSource react */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBootState } from "@/react-app/shell/boot-state";
import { ResearchBack } from "./page-shell";
import { useResearchClient } from "./use-research-client";

export function ResearchTemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { client, status } = useResearchClient();
  const { markRouteReady } = useBootState();

  const library = useQuery({
    queryKey: ["research", "templates"],
    queryFn: () => client!.listTemplates(),
    enabled: client !== null,
  });

  useEffect(() => {
    if (status !== "connecting" && !library.isPending) markRouteReady();
  }, [status, library.isPending, markRouteReady]);

  const seed = useMutation({
    mutationFn: () => client!.seedTemplates(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["research", "templates"] }),
  });
  const clone = useMutation({
    mutationFn: (id: string) => client!.cloneTemplate(id),
    onSuccess: (copy) => {
      void queryClient.invalidateQueries({ queryKey: ["research", "templates"] });
      navigate(`/research/templates/${encodeURIComponent(copy.id)}/edit?version=${encodeURIComponent(copy.version)}`);
    },
  });

  if (status !== "ready" || library.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (library.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Templates did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void library.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const entries = library.data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-start gap-2">
        <ResearchBack to="/research" label="projects" />
        <div>
        <h1 className="text-xl font-semibold tracking-tight">Research templates</h1>
        <p className="text-sm text-muted-foreground">
          Versioned research programs. Clone one to make it yours.
        </p>
        </div>
      </div>
      {entries.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No templates yet</CardTitle>
            <CardDescription>Install the seed template to start.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled={seed.isPending} onClick={() => seed.mutate()}>
              {seed.isPending ? "Installing…" : "Install seed template"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{entry.id}</CardTitle>
                  <CardDescription>Versions: {entry.versions.join(", ")}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/research/templates/${encodeURIComponent(entry.id)}/edit`)}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={clone.isPending} onClick={() => clone.mutate(entry.id)}>
                    Clone
                  </Button>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
