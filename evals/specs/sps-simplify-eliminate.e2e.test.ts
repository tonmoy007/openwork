import { navigate } from "@openwork/cdp";
import { spec } from "@openwork/testkit";
import type { Seed } from "@openwork/env";

async function simplifyGates(seed: Seed) {
  const workspacePath = seed.tmpPath("sps-simplify-gates");
  const app = await seed.appWeb({
    name: "sps-simplify-gates",
    workspacePath,
    headless: true,
  });
  const workspace = await seed.workspace(app, workspacePath);
  return { app, workspace };
}

const test = spec.world(simplifyGates, {
  resources: { surfaces: ["appWeb"], services: [] },
});

const SOP_TEXT = `# Ward Office Visit
Claimants visit the ward office up to 3 times on average. The board already holds marriage data.

# Officer Reviews Claim
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`;

test("SPS simplify gates: constraint, propose, decide, revise", async ({ world, user, step, evidence }) => {
  await step("reach a confirmed as-is", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research/new`);
    await user.type({ label: "Service name" }, "Welfare Grant — Simplify Gates", { verify: true });
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
    await user.see({ text: "All clear" });
    await user.click({ role: "button", text: "Confirm as-is" });
    await user.see({ text: "As-is confirmed" });
  });

  await step("capture a constraint and propose changes", async () => {
    await user.click({ role: "button", text: "Open simplification" });
    await user.see({ role: "heading", text: "Simplification" });
    await user.type({ label: "Constraint" }, "The officer decision stays.", { verify: true });
    await user.type({ label: "Why" }, "Labour Welfare Act s.14 names the decider.", { verify: true });
    await user.click({ role: "button", text: "Save constraint" });
    await user.see({ text: "The officer decision stays." });
    await user.click({ role: "button", text: "Propose changes" });
    await user.see({ text: /0 of 2 decided/ });
    evidence.recordAssertionEvidence(
      "Proposals run from constraints",
      "Saving one constraint unlocks heuristic proposals for both steps with a decided counter.",
      true,
    );
  });

  await step("accept, revise, and finish decided", async () => {
    await user.click({ role: "button", text: "Decide" });
    await user.click({ role: "button", text: "Accept" });
    await user.see({ text: /1 of 2 decided/ });
    await user.click({ role: "button", text: "Decide", nth: 1 });
    await user.type({ label: "Or revise the proposal" }, "Keep with digital assist.", { verify: true, replace: true });
    await user.type({ label: "Why is the revision better?" }, "Officer stays, intake moves online.", { verify: true });
    await user.click({ role: "button", text: "Save revision" });
    await user.see({ text: /2 of 2 decided/ });
    await user.see({ text: "All steps decided" });
    evidence.recordAssertionEvidence(
      "Decisions close the loop",
      "Accepting one proposal and revising the other completes every step with reasons on file.",
      true,
    );
  });
});
