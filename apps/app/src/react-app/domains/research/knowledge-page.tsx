/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

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
import { useBootState } from "@/react-app/shell/boot-state";
import { ResearchBack } from "./page-shell";
import { useResearchClient } from "./use-research-client";

const CATEGORIES = ["service-evidence", "global-standards", "local-sops"];
const EVIDENCE_TYPES = ["sop", "law", "form", "interview", "bpmn", "web"];

export function ResearchKnowledgePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { client, status } = useResearchClient();
  const { markRouteReady } = useBootState();

  const library = useQuery({
    queryKey: ["research", "knowledge"],
    queryFn: () => client!.listKBs(),
    enabled: client !== null,
  });

  useEffect(() => {
    if (status !== "connecting" && !library.isPending) markRouteReady();
  }, [status, library.isPending, markRouteReady]);

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
            <CardTitle>Knowledge bases did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void library.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-start gap-2">
        <ResearchBack to="/research" label="projects" />
        <div>
        <h1 className="text-xl font-semibold tracking-tight">Knowledge bases</h1>
        <p className="text-sm text-muted-foreground">
          Upload once, attach to any project. Detaching never deletes.
        </p>
        </div>
      </div>
      <NewKnowledgeBaseCard
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ["research", "knowledge"] })}
      />
      <div className="mt-4 flex flex-col gap-3">
        {(library.data ?? []).map((kb) => (
          <KnowledgeBaseCard
            key={kb.id}
            kbId={kb.id}
            name={kb.name}
            category={kb.category}
            scope={kb.scope}
            onOpen={() => navigate(`/research/knowledge/${encodeURIComponent(kb.id)}`)}
          />
        ))}
      </div>
    </div>
  );
}

function NewKnowledgeBaseCard({ onCreated }: { onCreated: () => void }) {
  const { client } = useResearchClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [scope, setScope] = useState("project");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => client!.createKB({ name: name.trim(), category, scope }),
    onSuccess: () => {
      setName("");
      setError(null);
      onCreated();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not create it."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>New knowledge base</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kb-name">Name</Label>
          <Input
            id="kb-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Labour legislation"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(value) => setCategory(value ?? CATEGORIES[0])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(value) => setScope(value ?? "project")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="global">Global</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div>
          <Button size="sm" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create knowledge base"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function KnowledgeBaseCard({ kbId, name, category, scope, onOpen }: {
  kbId: string;
  name: string;
  category: string;
  scope: string;
  onOpen: () => void;
}) {
  const { client } = useResearchClient();
  const files = useQuery({
    queryKey: ["research", "kb-files", kbId],
    queryFn: () => client!.listKBFiles(kbId),
    enabled: client !== null,
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{name}</CardTitle>
          <CardDescription>
            {category} · {scope} · {files.data?.length ?? 0} files
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={onOpen}>Open</Button>
      </CardHeader>
    </Card>
  );
}
