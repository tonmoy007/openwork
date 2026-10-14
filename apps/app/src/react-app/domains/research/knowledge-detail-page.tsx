/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useBootState } from "@/react-app/shell/boot-state";
import { ResearchBack } from "./page-shell";
import { useResearchClient } from "./use-research-client";
import { DeleteFileButton } from "./delete-file-button";

const EVIDENCE_TYPES = ["sop", "law", "form", "interview", "bpmn", "web"];

export function KnowledgeDetailPage() {
  const queryClient = useQueryClient();
  const { kbId = "" } = useParams();
  const { client, status } = useResearchClient();
  const { markRouteReady } = useBootState();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [url, setUrl] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [urlText, setUrlText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const files = useQuery({
    queryKey: ["research", "kb-files", kbId],
    queryFn: () => client!.listKBFiles(kbId),
    enabled: client !== null && kbId !== "",
  });

  useEffect(() => {
    if (status !== "connecting" && !files.isPending) markRouteReady();
  }, [status, files.isPending, markRouteReady]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["research", "kb-files", kbId] });

  const paste = useMutation({
    mutationFn: () =>
      client!.uploadKBFile(kbId, { name: fileName.trim() || "pasted-evidence.txt", type: "sop", text }),
    onSuccess: () => {
      setText("");
      setFileName("");
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Upload did not finish."),
  });

  const capture = useMutation({
    mutationFn: () =>
      client!.captureWeb(kbId, { url: url.trim(), title: urlTitle.trim() || undefined, text: urlText }),
    onSuccess: () => {
      setUrl("");
      setUrlTitle("");
      setUrlText("");
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Capture did not finish."),
  });

  async function uploadFiles(list: FileList | null) {
    if (!client || !list || list.length === 0 || uploading) return;
    setUploading(true);
    try {
      for (const file of [...list]) {
        await client.uploadKBFile(kbId, { name: file.name, type: "sop", file });
      }
      setError(null);
      invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload did not finish.");
    } finally {
      setUploading(false);
    }
  }

  if (status !== "ready" || files.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (files.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Knowledge base did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void files.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-start gap-2">
        <ResearchBack to="/research/knowledge" label="knowledge bases" />
        <div>
        <h1 className="text-xl font-semibold tracking-tight">Knowledge base files</h1>
        <p className="text-sm text-muted-foreground">
          {(files.data ?? []).length} files. Paste text, upload files, or capture from the web.
        </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Upload files</CardTitle>
          <CardDescription>PDF, Word, BPMN, or text — up to 5 MB each.</CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.bpmn,.xml,.txt,.md"
            className="hidden"
            aria-label="Choose knowledge base files"
            onChange={(event) => {
              void uploadFiles(event.target.files);
              event.target.value = "";
            }}
            disabled={uploading}
          />
          <div>
            <Button variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Uploading…" : "Choose files"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Paste text</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-paste-name">File name</Label>
            <Input id="kb-paste-name" value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="notes.txt" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-paste-text">Evidence text</Label>
            <Textarea id="kb-paste-text" value={text} onChange={(event) => setText(event.target.value)} rows={4} placeholder="Paste the document text here…" />
          </div>
          <div>
            <Button size="sm" disabled={paste.isPending || text.trim().length === 0} onClick={() => paste.mutate()}>
              {paste.isPending ? "Indexing…" : "Save pasted text"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Add from web</CardTitle>
          <CardDescription>Search with your agent, then capture the URL with quoted text. Citations travel with every claim.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-web-url">Source URL</Label>
            <Input id="kb-web-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-web-title">Title</Label>
            <Input id="kb-web-title" value={urlTitle} onChange={(event) => setUrlTitle(event.target.value)} placeholder="Page title" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kb-web-text">Quoted text</Label>
            <Textarea id="kb-web-text" value={urlText} onChange={(event) => setUrlText(event.target.value)} rows={4} placeholder="Paste the relevant passage…" />
          </div>
          <div>
            <Button size="sm" disabled={capture.isPending || url.trim().length === 0 || urlText.trim().length === 0} onClick={() => capture.mutate()}>
              {capture.isPending ? "Capturing…" : "Capture with citation"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert className="mb-4">
          <AlertTitle>Upload did not finish</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(files.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No files yet.</p>
          ) : (
            (files.data ?? []).map((file) => (
              <div key={file.file_id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {file.type} · {file.claims.length} sections
                    {file.source_url ? ` · ${file.source_url}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant={file.status === "indexed" ? "default" : file.status === "failed" ? "destructive" : "secondary"}>
                    {file.status}
                  </Badge>
                  <DeleteFileButton kbId={kbId} fileId={file.file_id} fileName={file.name} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
