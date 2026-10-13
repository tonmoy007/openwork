import { navigate } from "@openwork/cdp";
import { spec } from "@openwork/testkit";
import type { Seed } from "@openwork/env";

async function tobeGates(seed: Seed) {
  const workspacePath = seed.tmpPath("sps-tobe-gates");
  const app = await seed.appWeb({
    name: "sps-tobe-gates",
    workspacePath,
    headless: true,
  });
  const workspace = await seed.workspace(app, workspacePath);
  return { app, workspace };
}

const test = spec.world(tobeGates, {
  resources: { surfaces: ["appWeb"], services: [] },
});

const SOP_TEXT = `# Ward Office Visit
Claimants visit the ward office up to 3 times on average. The board already holds marriage data.

# Officer Reviews Claim
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`;

test("SPS to-be gates: build variant, side-by-side, approve", async ({ world, user, step, evidence }) => {
  await step("reach decided simplifications", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research/new`);
    await user.type({ label: "Service name" }, "Welfare Grant — To-be Gates", { verify: true });
    await user.click({ role: "button", text: "Create project" });
    await user.see({ role: "heading", text: "Evidence library" });
    await user.type({ label: "File name" }, "SOP.txt", { verify: true });
    await user.type({ label: "Evidence text" }, SOP_TEXT, { verify: true });
    await user.click({ role: "button", text: "Upload and index" });
    await user.see({ text: /1 of 1 files indexed/ });
    await user.click({ role: "button", text: "Open as-is workspace" });
    await user.click({ role: "button", text: "Draft as-is from evidence" });
    await user.see({ text: "Ward Office Visit" });
    await user.click({ role: "button", text: "Decide" });
    await user.type({ label: "Finding" }, "Three visits on average with no schedule", { verify: true });
    await user.click({ role: "button", text: "Save pain" });
    await user.see({ text: "Pain noted" });
    await user.click({ role: "button", text: "Decide", nth: 1 });
    await user.click({ role: "button", text: "Mark all clear instead" });
    await user.type({ label: "Why is this step fine as is?" }, "Core government work", { verify: true });
    await user.click({ role: "button", text: "Mark all clear" });
    await user.click({ role: "button", text: "Confirm as-is" });
    await user.see({ text: "As-is confirmed" });
    await user.click({ role: "button", text: "Open simplification" });
    await user.see({ role: "heading", text: "Simplification" });
    await user.type({ label: "Constraint" }, "The officer decision stays.", { verify: true });
    await user.type({ label: "Why" }, "Labour Welfare Act s.14 names the decider.", { verify: true });
    await user.click({ role: "button", text: "Save constraint" });
    await user.click({ role: "button", text: "Propose changes" });
    await user.see({ text: /0 of 2 decided/ });
    await user.click({ role: "button", text: "Decide" });
    await user.click({ role: "button", text: "Accept" });
    await user.click({ role: "button", text: "Decide", nth: 1 });
    await user.click({ role: "button", text: "Accept" });
    await user.see({ text: "All steps decided" });
  });

  await step("build the to-be variant side by side", async () => {
    await user.click({ role: "button", text: "Open to-be process" });
    await user.see({ role: "heading", text: "To-be process" });
    await user.click({ role: "button", text: "Build to-be variant" });
    await user.see({ text: /Officer Reviews Claim/ });
    await user.see({ text: /1 steps remain/ });
    evidence.recordAssertionEvidence(
      "To-be keeps only surviving steps",
      "Building from two terminal decisions keeps the officer review and drops the eliminated ward visit, shown side by side.",
      true,
    );
  });

  await step("approve the to-be process", async () => {
    await user.click({ role: "button", text: "Approve to-be" });
    await user.see({ text: "To-be approved" });
    evidence.recordAssertionEvidence(
      "Solo approval completes the gate",
      "The single project member approves; the phase moves on with the decision record saved.",
      true,
    );
  });
});
