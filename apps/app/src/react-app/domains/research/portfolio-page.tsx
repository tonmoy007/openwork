/** @jsxImportSource react */
import { useEffect } from "react";
import { FolderOpen } from "lucide-react";
import { useNavigate } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useBootState } from "@/react-app/shell/boot-state";
import { researchEvidenceRoute, researchNewProjectRoute } from "./research-routes";
import { useResearchClient, useResearchProjectsQuery } from "./use-research-client";

export function ResearchPortfolioPage() {
  const navigate = useNavigate();
  const { client, status } = useResearchClient();
  const projects = useResearchProjectsQuery(client);
  const { markRouteReady } = useBootState();

  useEffect(() => {
    if (status !== "connecting" && !projects.isPending) markRouteReady();
  }, [status, projects.isPending, markRouteReady]);

  if (status === "unavailable") {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Local server unavailable</CardTitle>
            <CardDescription>The desktop server is not reachable. Restart the app, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status !== "ready" || projects.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="mb-6 h-4 w-72" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (projects.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Research projects did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void projects.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const items = projects.data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Research projects</h1>
          <p className="text-sm text-muted-foreground">
            Simplification engagements, one row per project.
          </p>
        </div>
        <Button onClick={() => navigate(researchNewProjectRoute())}>New project</Button>
      </div>

      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <FolderOpen className="size-6" />
            </EmptyMedia>
            <EmptyTitle>No research projects yet</EmptyTitle>
            <EmptyDescription>
              Name a service to simplify. Evidence upload comes next.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => navigate(researchNewProjectRoute())}>
              Create a project
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((project) => (
            <Card key={project.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>
                    {[project.institution, project.country].filter(Boolean).join(" · ") ||
                      project.knowledge_category}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{project.phase}</Badge>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(researchEvidenceRoute(project.id))}
                >
                  Open evidence
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
