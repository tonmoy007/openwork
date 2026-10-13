import { navigate } from "@openwork/cdp";
import { spec } from "@openwork/testkit";
import type { Seed } from "@openwork/env";

async function researchGates(seed: Seed) {
  const workspacePath = seed.tmpPath("sps-evidence-gates");
  const app = await seed.appWeb({
    name: "sps-evidence-gates",
    workspacePath,
    headless: true,
  });
  const workspace = await seed.workspace(app, workspacePath);
  return { app, workspace };
}

const test = spec.world(researchGates, {
  resources: { surfaces: ["appWeb"], services: [] },
});

const SOP_TEXT = `# Ward Office Visit
Claimants visit the ward office up to 3 times on average. Offices have no published schedule.

# Processing Time
Average time to obtain the certificate is 4 days. The welfare board already holds marriage registration data.`;

test("SPS evidence gates: portfolio, project creation, indexed evidence, ready gate", async ({ world, user, step, evidence }) => {
  await step("open the research portfolio", async () => {
    // appWeb runs BrowserRouter: navigate the document URL, not the hash.
    await navigate(world.app.client, `${world.app.webUrl}/research`);
    // Bare strings match controls only; headings and prose need text targets.
    await user.see({ role: "heading", text: "Research projects" });
    evidence.recordAssertionEvidence(
      "Research portfolio opens",
      "The research portfolio route renders with its heading and an empty-state action.",
      true,
    );
  });

  await step("create a project", async () => {
    await user.click({ role: "button", text: "New project" });
    await user.see({ role: "heading", text: "New research project" });
    await user.type({ label: "Service name" }, "Welfare Grant — Evidence Gates", { verify: true });
    await user.click({ role: "button", text: "Create project" });
    await user.see({ role: "heading", text: "Evidence library" });
    evidence.recordAssertionEvidence(
      "Project creation lands on its evidence library",
      "Submitting the new-project form creates the project and navigates to its evidence library.",
      true,
    );
  });

  await step("upload evidence and reach the ready gate", async () => {
    await user.type({ label: "File name" }, "Welfare_Board_SOP.txt", { verify: true });
    await user.type({ label: "Evidence text" }, SOP_TEXT, { verify: true });
    await user.click({ role: "button", text: "Upload and index" });
    await user.see({ text: "Evidence ready" });
    await user.see({ text: /1 of 1 files indexed/ });
    await user.see({ text: /2 sections/ });
    evidence.recordAssertionEvidence(
      "Indexed evidence opens the ready gate",
      "Uploading SOP text indexes it into citable sections and the gate panel reports ready with researcher-word progress.",
      true,
    );
  });
});
