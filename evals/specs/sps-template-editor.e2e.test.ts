import { navigate } from "@openwork/cdp";
import { spec } from "@openwork/testkit";
import type { Seed } from "@openwork/env";

async function templateEditor(seed: Seed) {
  const workspacePath = seed.tmpPath("sps-template-editor");
  const app = await seed.appWeb({
    name: "sps-template-editor",
    workspacePath,
    headless: true,
  });
  const workspace = await seed.workspace(app, workspacePath);
  return { app, workspace };
}

const test = spec.world(templateEditor, {
  resources: { surfaces: ["appWeb"], services: [] },
});

test("SPS template editor: seed, clone, bump, publish, reuse", async ({ world, user, step, evidence }) => {
  await step("install the seed template", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research/templates`);
    await user.see({ role: "heading", text: "Research templates" });
    await user.click({ role: "button", text: "Install seed template" });
    await user.see({ text: "sps-ecrs-v1" });
    evidence.recordAssertionEvidence(
      "Seed installs into an empty library",
      "Installing seeds sps-ecrs-v1 with its pinned version.",
      true,
    );
  });

  await step("clone and publish a minor bump", async () => {
    await user.click({ role: "button", text: "Clone" });
    await user.see({ role: "heading", text: "Edit sps-ecrs-v1-copy" });
    await user.click({ role: "button", text: "Bump minor" });
    await user.see({ text: /Version 1\.1/ });
    await user.click({ role: "button", text: "Publish" });
    await user.see({ role: "heading", text: "Research templates" });
    await user.see({ text: /1\.0, 1\.1/ });
    evidence.recordAssertionEvidence(
      "Clone, bump, and publish create a new version",
      "The copy publishes as 1.1 alongside 1.0 in the library.",
      true,
    );
  });

  await step("new projects offer the republished template", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research/new`);
    await user.click({ role: "radio", label: "sps-ecrs-v1-copy@1.1" });
    await user.type({ label: "Service name" }, "Copy Template Project", { verify: true });
    await user.click({ role: "button", text: "Create project" });
    await user.see({ role: "heading", text: "Evidence library" });
    evidence.recordAssertionEvidence(
      "Republished templates are selectable",
      "A new project binds the republished copy version and lands on its evidence library.",
      true,
    );
  });
});
