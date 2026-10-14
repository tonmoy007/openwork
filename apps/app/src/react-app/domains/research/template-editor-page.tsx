/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CostError, evaluateFormula } from "@openwork/process-model/cost";
import { useBootState } from "@/react-app/shell/boot-state";
import { ResearchBack } from "./page-shell";
import { useResearchClient } from "./use-research-client";

const PRESETS: Record<string, Record<string, number>> = {
  balanced: { capability: 0.35, evidence: 0.25, quality: 0.2, cost: 0.1, latency: 0.1 },
  most_careful: { capability: 0.45, evidence: 0.3, quality: 0.2, cost: 0.03, latency: 0.02 },
  cheapest: { capability: 0.25, evidence: 0.2, quality: 0.15, cost: 0.3, latency: 0.1 },
  fastest: { capability: 0.25, evidence: 0.2, quality: 0.15, cost: 0.1, latency: 0.3 },
};

const ALL_OUTPUTS = [
  "table", "bpmn_svg", "bpmn_xml", "impact_cards", "charts", "flow_visualizer",
  "report_html", "report_pdf", "blueprint_html", "blueprint_pdf",
  "decision_html", "decision_pdf", "table_xlsx", "decision_record",
];

const FIXTURE_CONTEXT = {
  as_is: { visits: [3, 1, 1, 1, 2, 2, 0] },
  tobe: { visits: [0, 1, 0] },
};

type TemplateDoc = Record<string, unknown>;

function parseDoc(text: string): { doc?: TemplateDoc; error?: string } {
  try {
    const doc = JSON.parse(text) as TemplateDoc;
    if (typeof doc !== "object" || doc === null) return { error: "Template must be a JSON object." };
    return { doc };
  } catch {
    return { error: "Invalid JSON — fix the syntax to publish." };
  }
}

function bumpVersion(version: string, kind: "minor" | "major"): string {
  const [major, minor] = version.split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return version;
  return kind === "major" ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

export function ResearchTemplateEditorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { templateId = "" } = useParams();
  const [search] = useSearchParams();
  const { client, status } = useResearchClient();
  const { markRouteReady } = useBootState();
  const [jsonText, setJsonText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testFormula, setTestFormula] = useState("pct(sum(as_is.visits), sum(tobe.visits))");

  const doc = useQuery({
    queryKey: ["research", "template", templateId, search.get("version") ?? "latest"],
    queryFn: () => client!.getTemplateDoc(templateId, search.get("version") ?? undefined),
    enabled: client !== null && templateId !== "",
  });

  useEffect(() => {
    if (status !== "connecting" && !doc.isPending) markRouteReady();
  }, [status, doc.isPending, markRouteReady]);

  useEffect(() => {
    if (doc.data && !loaded) {
      setJsonText(JSON.stringify(JSON.parse(doc.data.doc_json), null, 2));
      setLoaded(true);
    }
  }, [doc.data, loaded]);

  const parsed = useMemo(() => parseDoc(jsonText), [jsonText]);
  const savedText = doc.data ? JSON.stringify(JSON.parse(doc.data.doc_json), null, 2).trim() : null;
  const dirty = savedText !== null && jsonText.trim() !== savedText;
  const parsedDoc = parsed.doc as (TemplateDoc & {
    version?: string;
    outputs?: string[];
    cost_model?: { measures?: string[] };
    agents?: { routing?: { preset?: string; weights?: Record<string, number> } };
    simplification?: { criteria?: Array<{ id?: string; label?: string; evaluation_prompt?: string }> };
  }) | undefined;

  const publish = useMutation({
    mutationFn: (next: string) => client!.saveTemplateDraft(next),
    onSuccess: () => {
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey: ["research", "templates"] });
      navigate("/research/templates");
    },
    onError: (cause) => setSaveError(cause instanceof Error ? cause.message : "Publish did not finish."),
  });

  function updateDoc(mutator: (doc: TemplateDoc) => void) {
    if (!parsed.doc) return;
    const next = JSON.parse(JSON.stringify(parsed.doc)) as TemplateDoc;
    mutator(next);
    setJsonText(JSON.stringify(next, null, 2));
  }

  function setPreset(preset: string) {
    updateDoc((next) => {
      const doc = next as { agents?: { routing?: { preset?: string; weights?: Record<string, number> } } };
      if (!doc.agents) doc.agents = {};
      if (!doc.agents.routing) doc.agents.routing = {};
      doc.agents.routing.preset = preset;
      if (PRESETS[preset]) doc.agents.routing.weights = { ...PRESETS[preset] };
    });
  }

  function setWeight(key: string, value: number) {
    updateDoc((next) => {
      const doc = next as { agents?: { routing?: { preset?: string; weights?: Record<string, number> } } };
      if (!doc.agents?.routing?.weights) return;
      doc.agents.routing.weights[key] = value;
      doc.agents.routing.preset = "custom";
    });
  }

  function toggleOutput(output: string) {
    updateDoc((next) => {
      const doc = next as { outputs?: string[] };
      const current = new Set(doc.outputs ?? []);
      if (current.has(output)) current.delete(output);
      else current.add(output);
      doc.outputs = [...current];
    });
  }

  function bump(kind: "minor" | "major") {
    updateDoc((next) => {
      const doc = next as { version?: string };
      if (typeof doc.version === "string") doc.version = bumpVersion(doc.version, kind);
    });
  }

  const weights = parsedDoc?.agents?.routing?.weights;
  let formulaResult: string;
  try {
    const result = evaluateFormula(
      testFormula,
      FIXTURE_CONTEXT,
      new Set(parsedDoc?.cost_model?.measures ?? ["visits"]),
    );
    formulaResult =
      result.value === null
        ? `unknown${result.warnings.length > 0 ? ` (${result.warnings.join("; ")})` : ""}`
        : String(result.value);
  } catch (error) {
    formulaResult = error instanceof CostError ? error.message : "Could not evaluate.";
  }

  if (status !== "ready" || doc.isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <Skeleton className="mb-2 h-7 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (doc.isError || !doc.data) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Template did not load</CardTitle>
            <CardDescription>Check the local server is running, then try again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void doc.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <ResearchBack to="/research/templates" label="templates" />
          <div>
          <h1 className="text-xl font-semibold tracking-tight">Edit {templateId}</h1>
          <p className="text-sm text-muted-foreground">
            Version {parsedDoc?.version ?? "?"} {dirty ? "· unsaved changes" : "· saved"}
          </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => bump("minor")}>Bump minor</Button>
          <Button size="sm" variant="outline" onClick={() => bump("major")}>Bump major</Button>
          <Button
            size="sm"
            disabled={!parsed.doc || !dirty || publish.isPending}
            onClick={() => parsed.doc && publish.mutate(JSON.stringify(parsed.doc))}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>
      {parsed.error || saveError ? (
        <Alert className="mb-4">
          <AlertTitle>Cannot publish yet</AlertTitle>
          <AlertDescription>{parsed.error ?? saveError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Form</CardTitle>
            <CardDescription>Common edits. Everything else lives in the JSON.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Routing preset</Label>
              <div className="flex flex-wrap gap-2">
                {[...Object.keys(PRESETS), "custom"].map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    variant={parsedDoc?.agents?.routing?.preset === preset ? "default" : "outline"}
                    onClick={() => preset !== "custom" && setPreset(preset)}
                    disabled={preset === "custom"}
                  >
                    {preset.replace("_", " ")}
                  </Button>
                ))}
              </div>
            </div>
            {weights ? (
              <div className="flex flex-col gap-1.5">
                <Label>Weights (must sum to 1)</Label>
                {Object.entries(weights).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-24 text-sm">{key}</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={value}
                      onChange={(event) => setWeight(key, Number(event.target.value))}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Sum: {Math.round(Object.values(weights).reduce((a, b) => a + b, 0) * 100) / 100}. Editing a
                  weight switches the preset to custom.
                </p>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label>Outputs</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_OUTPUTS.map((output) => (
                  <Button
                    key={output}
                    size="sm"
                    variant={parsedDoc?.outputs?.includes(output) ? "default" : "outline"}
                    onClick={() => toggleOutput(output)}
                  >
                    {output}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Criteria ({parsedDoc?.simplification?.criteria?.length ?? 0})</Label>
              <p className="text-xs text-muted-foreground">
                {(parsedDoc?.simplification?.criteria ?? [])
                  .map((criterion) => criterion.id ?? "?")
                  .join(", ") || "none"}
              </p>
              <p className="text-xs text-muted-foreground">Add or remove criteria in the JSON panel.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="formula-test">Formula tester (visits fixture)</Label>
              <Input
                id="formula-test"
                value={testFormula}
                onChange={(event) => setTestFormula(event.target.value)}
              />
              <p className="text-sm">
                Result: <span className="font-mono font-semibold">{formulaResult}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>JSON</CardTitle>
            <CardDescription>Full template document. Invalid JSON blocks publishing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              rows={28}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
