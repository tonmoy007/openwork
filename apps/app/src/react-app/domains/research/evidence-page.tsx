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
import { Progress } from "@/components/ui/progress";
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
import { researchAsisRoute, researchPortfolioRoute } from "./research-routes";
import { useResearchClient } from "./use-research-client";

const EVIDENCE_TYPES = ["sop", "law", "form", "interview", "bpmn", "web"];

function MarkdownComposer({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { client } = useResearchClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      client!.uploadResearchEvidence(projectId, {
        name: `${title.trim() || "notes"}.md`,
        type: "sop",
        text: body,
      }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["research", "evidence", projectId] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Could not save the note."),
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Write markdown</CardTitle>
        <CardDescription>
          Author a note in place. Headings become citable sections on indexing.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="md-title">Title</Label>
          <Input
            id="md-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Field visit notes"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="md-body">Markdown</Label>
          <Textarea
            id="md-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={"# Ward visit\n\nThree attempts, no schedule posted…"}
            rows={10}
            className="font-mono"
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div>
          <Button
            disabled={save.isPending || body.trim().length === 0}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save note"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ResearchEvidencePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projectId = "" } = useParams();
  const { client, status } = useResearchClient();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState(EVIDENCE_TYPES[0]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; status: string; error?: string }>>([]);

  const evidence = useQuery({
    queryKey: ["research", "evidence", projectId],
    queryFn: () => client!.getResearchEvidence(projectId),
    enabled: client !== null && projectId !== "",
  });
  const attached = useQuery({
    queryKey: ["research", "attached", projectId],
    queryFn: () => client!.attachedKBs(projectId),
    enabled: client !== null && projectId !== "",
  });
  const library = useQuery({
    queryKey: ["research", "knowledge"],
    queryFn: () => client!.listKBs(),
    enabled: client !== null,
  });
  const [attachId, setAttachId] = useState("");
  const { markRouteReady } = useBootState();

  useEffect(() => {
    if (status !== "connecting" && !evidence.isPending) markRouteReady();
  }, [status, evidence.isPending, markRouteReady]);

  const upload = useMutation({
    mutationFn: () =>
      client!.uploadResearchEvidence(projectId, {
        name: fileName.trim() || "pasted-evidence.txt",
        type: fileType,
        text,
      }),
    onSuccess: () => {
      setText("");
      setFileName("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["research", "evidence", projectId] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Upload did not finish."),
  });

  async function uploadFiles(list: FileList | null) {
    if (!client || !list || list.length === 0 || uploading) return;
    setUploading(true);
    try {
      for (const file of [...list]) {
        setUploads((current) => [...current.filter((entry) => entry.name !== file.name), { name: file.name, status: "reading" }]);
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            resolve(result.includes(",") ? result.split(",").slice(1).join(",") : result);
          };
          reader.onerror = () => reject(new Error("Could not read the file."));
          reader.readAsDataURL(file);
        }).catch(() => null);
        if (dataBase64 === null) {
          setUploads((current) => current.map((entry) => entry.name === file.name ? { ...entry, status: "failed", error: "Could not read the file." } : entry));
          continue;
        }
        setUploads((current) => current.map((entry) => entry.name === file.name ? { ...entry, status: "uploading" } : entry));
        try {
          await client.uploadResearchBinary(projectId, { name: file.name, type: fileType, dataBase64 });
          setUploads((current) => current.map((entry) => entry.name === file.name ? { ...entry, status: "indexed" } : entry));
        } catch (cause) {
          setUploads((current) => current.map((entry) => entry.name === file.name ? { ...entry, status: "failed", error: cause instanceof Error ? cause.message : "Upload did not finish." } : entry));
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["research", "evidence", projectId] });
    } finally {
      setUploading(false);
    }
  }

  const attach = useMutation({
    mutationFn: (kb_id: string) => client!.attachKB(projectId, kb_id),
    onSuccess: () => {
      setAttachId("");
      void queryClient.invalidateQueries({ queryKey: ["research", "attached", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["research", "evidence", projectId] });
    },
  });
  const detach = useMutation({
    mutationFn: (kb_id: string) => client!.detachKB(projectId, kb_id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["research", "attached", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["research", "evidence", projectId] });
    },
  });

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

  if (status !== "ready" || evidence.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="mb-6 h-4 w-72" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (evidence.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Evidence did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void evidence.refetch()}>
                Try again
              </Button>
              <Button variant="ghost" onClick={() => navigate(researchPortfolioRoute())}>
                Back to projects
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const files = evidence.data.files;
  const gate = evidence.data.gate;
  const indexed = gate.indexed_count;
  const total = Math.max(gate.total_count, 1);
  const attachedList = attached.data ?? [];
  const unattached = (library.data ?? []).filter(
    (kb) => !attachedList.some((entry) => entry.id === kb.id),
  );
  const groups = new Map<string, { name: string; files: typeof files }>();
  for (const file of files) {
    const kb = attachedList.find((entry) => entry.id === file.kb_id);
    const key = file.kb_id ?? "unknown";
    const group = groups.get(key) ?? { name: kb?.name ?? "Unknown source", files: [] };
    group.files.push(file);
    groups.set(key, group);
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Evidence library</h1>
        <p className="text-sm text-muted-foreground">
          Every law, SOP, form, and observation cited and tagged.
        </p>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Upload files</CardTitle>
          <CardDescription>
            PDF, Word, BPMN, or text — up to 5 MB each. Unreadable files stay listed as failed with the reason.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            type="file"
            multiple
            accept=".pdf,.docx,.bpmn,.xml,.txt,.md"
            onChange={(event) => void uploadFiles(event.target.files)}
            disabled={uploading}
          />
          {uploads.length > 0 ? (
            <div className="flex flex-col gap-2">
              {uploads.map((upload) => (
                <div key={upload.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{upload.name}</span>
                  <Badge variant={upload.status === "indexed" ? "default" : upload.status === "failed" ? "destructive" : "secondary"}>
                    {upload.status === "failed" && upload.error ? `failed: ${upload.error}` : upload.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Add evidence</CardTitle>
          <CardDescription>
            Paste SOPs, laws, forms, or interview notes. Each upload is indexed into citable sections.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="evidence-name">File name</Label>
              <Input
                id="evidence-name"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder="Welfare_Board_SOP_2019.txt"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={fileType} onValueChange={(value) => setFileType(value ?? EVIDENCE_TYPES[0])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVIDENCE_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="evidence-text">Evidence text</Label>
            <Textarea
              id="evidence-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the document text here…"
              rows={6}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div>
            <Button
              disabled={upload.isPending || text.trim().length === 0}
              onClick={() => upload.mutate()}
            >
              {upload.isPending ? "Indexing…" : "Upload and index"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <MarkdownComposer projectId={projectId} />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Attached knowledge</CardTitle>
          <CardDescription>Detaching hides files from this project without deleting them.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {attachedList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing attached yet.</p>
          ) : (
            attachedList.map((kb) => (
              <div key={kb.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{kb.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {kb.category} · {kb.file_count} files
                  </p>
                </div>
                <Button size="sm" variant="ghost" disabled={detach.isPending} onClick={() => detach.mutate(kb.id)}>
                  Detach
                </Button>
              </div>
            ))
          )}
          {unattached.length > 0 ? (
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Attach a knowledge base">
              {unattached.map((kb) => (
                <label key={kb.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="attach-kb"
                    value={kb.id}
                    checked={attachId === kb.id}
                    onChange={() => setAttachId(kb.id)}
                  />
                  <span>{kb.name}</span>
                </label>
              ))}
              <div>
                <Button
                  size="sm"
                  disabled={!attachId || attach.isPending}
                  onClick={() => attach.mutate(attachId)}
                >
                  Attach
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate("/research/knowledge")}>
                New knowledge base
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            Indexed {indexed} of {gate.total_count} files
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Progress value={(indexed / total) * 100} />
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No evidence files yet. Upload above or attach a knowledge base.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {[...groups.entries()].map(([key, group]) => (
                <div key={key}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.name}
                  </p>
                  <div className="flex flex-col gap-2">
                    {group.files.map((file) => (
                      <div
                        key={file.file_id}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {file.type} · {file.claims.length} sections
                          </p>
                        </div>
                        <Badge variant={file.status === "indexed" ? "default" : file.status === "failed" ? "destructive" : "secondary"}>
                          {file.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {gate.ready ? (
        <Alert>
          <AlertTitle>Evidence ready</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{gate.reasons[0]}</span>
            <span>
              <Button size="sm" onClick={() => navigate(researchAsisRoute(projectId))}>
                Open as-is workspace
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTitle>Not ready to start simplifying</AlertTitle>
          <AlertDescription>{gate.reasons.join(" ")}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
