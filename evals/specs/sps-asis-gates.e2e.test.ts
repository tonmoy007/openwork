import { navigate } from "@openwork/cdp";
import { spec } from "@openwork/testkit";
import type { Seed } from "@openwork/env";

async function asisGates(seed: Seed) {
  const workspacePath = seed.tmpPath("sps-asis-gates");
  const app = await seed.appWeb({
    name: "sps-asis-gates",
    workspacePath,
    headless: true,
  });
  const workspace = await seed.workspace(app, workspacePath);
  return { app, workspace };
}

const test = spec.world(asisGates, {
  resources: { surfaces: ["appWeb"], services: [] },
});

const SOP_TEXT = `# Ward Office Visit
Claimants visit the ward office up to 3 times on average. Offices have no published schedule.

# Officer Reviews Claim
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`;

test("SPS as-is gates: draft, pain, all-clear, confirm", async ({ world, user, step, evidence }) => {
  await step("create a project with indexed evidence", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research/new`);
    await user.see({ role: "heading", text: "New research project" });
    await user.type({ label: "Service name" }, "Welfare Grant — As-is Gates", { verify: true });
    await user.click({ role: "button", text: "Create project" });
    await user.see({ role: "heading", text: "Evidence library" });
    await user.type({ label: "File name" }, "SOP.txt", { verify: true });
    await user.type({ label: "Evidence text" }, SOP_TEXT, { verify: true });
    await user.click({ role: "button", text: "Upload and index" });
    await user.see({ text: /1 of 1 files indexed/ });
  });

  await step("draft the as-is process from evidence", async () => {
    await user.click({ role: "button", text: "Open as-is workspace" });
    await user.see({ role: "heading", text: "As-is process" });
    await user.click({ role: "button", text: "Draft as-is from evidence" });
    await user.see({ text: "Ward Office Visit" });
    await user.see({ text: "Officer Reviews Claim" });
    evidence.recordAssertionEvidence(
      "Draft renders cited steps",
      "Drafting from one indexed file produces two steps with evidence section counts.",
      true,
    );
  });

  await step("note a pain on the first step", async () => {
    await user.click({ role: "button", text: "Decide" });
    await user.type({ label: "Finding" }, "Three visits on average with no schedule", { verify: true });
    await user.click({ role: "button", text: "Save pain" });
    await user.see({ text: "Pain noted" });
    evidence.recordAssertionEvidence(
      "Pain attaches with evidence",
      "Saving a pain records it against the step with its cited evidence sections.",
      true,
    );
  });

  await step("clear the second step and confirm", async () => {
    await user.click({ role: "button", text: "Decide", nth: 1 });
    await user.click({ role: "button", text: "Mark all clear instead" });
    await user.type({ label: "Why is this step fine as is?" }, "Core government work required by law", { verify: true });
    await user.click({ role: "button", text: "Mark all clear" });
    await user.see({ text: "All clear" });
    await user.see({ text: "Ready to confirm" });
    await user.click({ role: "button", text: "Confirm as-is" });
    await user.see({ text: "As-is confirmed" });
    evidence.recordAssertionEvidence(
      "Confirm gates on resolved steps",
      "Marking the second step all-clear completes the gate; confirming moves the project to simplification.",
      true,
    );
  });
});
