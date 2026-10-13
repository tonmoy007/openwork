/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  createOpenworkServerClient,
  type OpenworkServerClient,
} from "@/app/lib/openwork-server";
import { createOpenworkServerStore } from "@/react-app/domains/connections/openwork-server-store";

async function localStorageClient(): Promise<OpenworkServerClient | null> {
  try {
    const port = window.localStorage.getItem("openwork.server.port")?.trim();
    const token = window.localStorage.getItem("openwork.server.token")?.trim();
    if (!port) return null;
    const client = createOpenworkServerClient({
      baseUrl: `http://127.0.0.1:${port}`,
      token: token || undefined,
    });
    await client.health();
    return client;
  } catch {
    return null;
  }
}

export function useResearchClient(): {
  client: OpenworkServerClient | null;
  status: "connecting" | "ready" | "unavailable";
} {
  const store = useMemo(
    () =>
      createOpenworkServerStore({
        startupPreference: () => "local",
        documentVisible: () =>
          typeof document === "undefined" || document.visibilityState === "visible",
        developerMode: () => false,
        runtimeWorkspaceId: () => null,
      }),
    [],
  );
  const [client, setClient] = useState<OpenworkServerClient | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let live = true;
    void store
      .ensureLocalOpenworkServerClient()
      .then((resolved) => resolved ?? localStorageClient())
      .then((resolved) => {
        if (!live) return;
        setClient(resolved);
        setSettled(true);
      });
    return () => {
      live = false;
    };
  }, [store]);

  if (!settled) return { client: null, status: "connecting" };
  if (!client) return { client: null, status: "unavailable" };
  return { client, status: "ready" };
}

export function useResearchProjectsQuery(client: OpenworkServerClient | null) {
  return useQuery({
    queryKey: ["research", "projects"],
    queryFn: () => client!.listResearchProjects(),
    enabled: client !== null,
  });
}
