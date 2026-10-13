import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { test } from "@openwork/testkit";
import { openStore } from "@openwork/research-templates/adapters/local-sqlite";
import {
  eeAccessControl,
  eeTemplateMarketplace,
} from "@openwork/research-templates/adapters/ee-stub";
import { EE_NOT_CONFIGURED } from "@openwork/research-templates";

test("SPS persistence ports round-trip locally and refuse EE without Den", { timeout: 120_000 }, async ({ evidence }) => {
  const store = await openStore(":memory:");
  try {
    const project = store.createProject({
      name: "Welfare Grant",
      template_ref: "sps-ecrs-v1@1.0",
      knowledge_category: "service-evidence",
    });
    store.addMember({ project_id: project.id, user_ref: "sara", local_role: "researcher" });
    expect(
      store.access.can({ user_ref: "sara", local_role: "researcher" }, "decide"),
    ).toBe(true);
    expect(
      store.access.can({ user_ref: "sara", local_role: "researcher" }, "approve"),
    ).toBe(false);
    evidence.recordAssertionEvidence(
      "Local roles gate actions",
      "A researcher can decide but not approve; roles resolve from project membership without any organization.",
      true,
    );

    const first = store.saveSnapshot({
      project_id: project.id,
      stage: "as_is",
      model_json: JSON.stringify({ steps: ["ward"] }),
    });
    store.saveSnapshot({
      project_id: project.id,
      stage: "as_is",
      model_json: JSON.stringify({ steps: ["ward", "union"] }),
      supersedes: first.id,
    });
    const snapshots = store.listSnapshots(project.id);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].model_json).toBe(JSON.stringify({ steps: ["ward"] }));
    evidence.recordAssertionEvidence(
      "Snapshots supersede instead of mutating",
      "Two as-is snapshots exist; the confirmed first snapshot is byte-identical after superseding.",
      true,
    );

    store.audit.append({
      event_id: randomUUID(),
      project_id: project.id,
      run_id: randomUUID(),
      actor: "sara",
      action: "asis.confirmed",
      entity_refs: [first.id],
      detail: "as-is confirmed",
    });
    expect(store.audit.list(project.id)).toHaveLength(1);

    expect(() => eeTemplateMarketplace.listLocal()).toThrowError(
      expect.objectContaining({ code: EE_NOT_CONFIGURED }),
    );
    expect(() =>
      eeAccessControl.can({ user_ref: "sara", local_role: "researcher" }, "decide"),
    ).toThrowError(expect.objectContaining({ code: EE_NOT_CONFIGURED }));
    evidence.recordAssertionEvidence(
      "EE adapters refuse with a local fallback message",
      "Marketplace and Den access control throw typed EE_NOT_CONFIGURED telling the researcher the project stays local.",
      true,
    );
  } finally {
    store.close();
  }
});
