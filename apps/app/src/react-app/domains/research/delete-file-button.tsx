/** @jsxImportSource react */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useResearchClient } from "./use-research-client";

/** Two-step delete: Delete → Confirm delete. Detached from any page. */
export function DeleteFileButton({ kbId, fileId, fileName }: {
  kbId: string | null;
  fileId: string;
  fileName: string;
}) {
  const queryClient = useQueryClient();
  const { client } = useResearchClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => client!.deleteKBFile(kbId ?? "", fileId),
    onSuccess: () => {
      setConfirming(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["research", "evidence"] });
      void queryClient.invalidateQueries({ queryKey: ["research", "kb-files"] });
      void queryClient.invalidateQueries({ queryKey: ["research", "attached"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Delete did not finish."),
  });

  if (!kbId) return null;
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Delete ${fileName}`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Delete {fileName}?</span>
      <Button
        size="sm"
        variant="destructive"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        Confirm delete
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
