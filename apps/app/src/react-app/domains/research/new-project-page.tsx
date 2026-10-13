/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { useBootState } from "@/react-app/shell/boot-state";
import { researchEvidenceRoute } from "./research-routes";
import { useResearchClient } from "./use-research-client";

const KNOWLEDGE_CATEGORIES = ["service-evidence", "global-standards", "local-sops"];
const TEMPLATES = ["sps-ecrs-v1@1.0"];

export function ResearchNewProjectPage() {
  const navigate = useNavigate();
  const { client, status } = useResearchClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [country, setCountry] = useState("");
  const [institution, setInstitution] = useState("");
  const [category, setCategory] = useState(KNOWLEDGE_CATEGORIES[0]);
  const [template, setTemplate] = useState(TEMPLATES[0]);
  const [error, setError] = useState<string | null>(null);
  const { markRouteReady } = useBootState();

  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  const create = useMutation({
    mutationFn: () =>
      client!.createResearchProject({
        name: name.trim(),
        description: description.trim(),
        country: country.trim(),
        institution: institution.trim(),
        template_ref: template,
        knowledge_category: category,
      }),
    onSuccess: (project) => navigate(researchEvidenceRoute(project.id)),
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Could not create the project."),
  });

  const ready = status === "ready" && !create.isPending;
  const valid = name.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-xl p-6">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">New research project</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        The basics. Evidence upload comes next.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Project details</CardTitle>
          <CardDescription>Shown in the portfolio list.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="research-name">Service name</Label>
            <Input
              id="research-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Welfare Grant — Family of a Deceased Worker"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="research-description">Description</Label>
            <Textarea
              id="research-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What does this service do, and for whom?"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="research-country">Country</Label>
              <Input
                id="research-country"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="Bangladesh"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="research-institution">Institution</Label>
              <Input
                id="research-institution"
                value={institution}
                onChange={(event) => setInstitution(event.target.value)}
                placeholder="Department of Labour"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Knowledge base</Label>
              <Select value={category} onValueChange={(value) => setCategory(value ?? KNOWLEDGE_CATEGORIES[0])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_CATEGORIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Research template</Label>
              <Select value={template} onValueChange={(value) => setTemplate(value ?? TEMPLATES[0])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button disabled={!ready || !valid} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
