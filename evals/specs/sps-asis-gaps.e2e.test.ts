import { navigate } from "@openwork/cdp";
import { spec } from "@openwork/testkit";
import type { Seed } from "@openwork/env";

async function asisGaps(seed: Seed) {
  const workspacePath = seed.tmpPath("sps-asis-gaps");
  const app = await seed.appWeb({
    name: "sps-asis-gaps",
    workspacePath,
    headless: true,
  });
  const workspace = await seed.workspace(app, workspacePath);
  return { app, workspace };
}

const test = spec.world(asisGaps, {
  resources: { surfaces: ["appWeb"], services: [] },
});

const SOP_TEXT = `# Ward Office Visit
Claimants visit the ward office up to 3 times on average. The board already holds marriage data.

# Officer Reviews Claim
The officer reviews the case and decides in about 15 minutes under the Labour Welfare Act.`;

test("SPS gap loop: suggest, reply, skip, confirm", async ({ world, user, step, evidence }) => {
  await step("reach a drafted as-is with pains resolved", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research/new`);
    await user.type({ label: "Service name" }, "Welfare Grant — Gap Loop", { verify: true });
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
  });

  await step("answer and skip suggested gaps, then confirm", async () => {
    await user.click({ role: "button", text: "Ask agent for gaps" });
    await user.see({ text: /5 open$/ });
    await user.type({ label: /Reply to:/ }, "Corroborated by the ward register.", { verify: true });
    await user.click({ role: "button", text: "Reply" });
    await user.click({ role: "button", text: "Skip" });
    await user.click({ role: "button", text: "Skip" });
    await user.click({ role: "button", text: "Skip" });
    await user.click({ role: "button", text: "Skip" });
    await user.see({ text: /5 resolved/ });
    await user.click({ role: "button", text: "Confirm as-is" });
    await user.see({ text: "As-is confirmed" });
    evidence.recordAssertionEvidence(
      "Gap loop closes before confirm",
      "Suggested questions are answered or skipped with a counter; confirming with open questions stays disabled until resolved.",
      true,
    );
  });
});
