import { navigate } from "@openwork/cdp";
import { spec } from "@openwork/testkit";
import type { Seed } from "@openwork/env";

async function knowledgeAttach(seed: Seed) {
  const workspacePath = seed.tmpPath("sps-knowledge-attach");
  const app = await seed.appWeb({
    name: "sps-knowledge-attach",
    workspacePath,
    headless: true,
  });
  const workspace = await seed.workspace(app, workspacePath);
  return { app, workspace };
}

const test = spec.world(knowledgeAttach, {
  resources: { surfaces: ["appWeb"], services: [] },
});

const SOP_TEXT = `# Ward Office Visit
Claimants visit the ward office up to 3 times on average. Offices have no published schedule.`;

test("SPS knowledge attach: upload to KB, attach, gate sees union, detach drops", async ({ world, user, step, evidence }) => {
  await step("create a project and an independent knowledge base", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research/new`);
    await user.type({ label: "Service name" }, "Welfare Grant — KB Attach", { verify: true });
    await user.click({ role: "button", text: "Create project" });
    await user.see({ role: "heading", text: "Evidence library" });
    await navigate(world.app.client, `${world.app.webUrl}/research/knowledge`);
    await user.see({ role: "heading", text: "Knowledge bases" });
    await user.type({ label: "Name" }, "Ward Evidence", { verify: true });
    await user.click({ role: "button", text: "Create knowledge base" });
    await user.see({ text: "Ward Evidence" });
    evidence.recordAssertionEvidence(
      "Knowledge bases live outside projects",
      "A knowledge base is created from the library without any project context.",
      true,
    );
  });

  await step("upload text into the knowledge base", async () => {
    await user.click({ role: "button", text: "Open" });
    await user.see({ role: "heading", text: "Knowledge base files" });
    await user.type({ label: "File name" }, "SOP.txt", { verify: true });
    await user.type({ label: "Evidence text" }, SOP_TEXT, { verify: true });
    await user.click({ role: "button", text: "Save pasted text" });
    await user.see({ text: "SOP.txt" });
  });

  await step("attach the base and watch the gate open", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research`);
    await user.see({ role: "heading", text: "Research projects" });
    await user.click({ role: "button", text: "Open evidence" });
    await user.see({ role: "heading", text: "Evidence library" });
    await user.click({ role: "radio", label: "Ward Evidence" });
    await user.click({ role: "button", text: "Attach" });
    await user.see({ text: "Ward Evidence" });
    await user.see({ text: "SOP.txt" });
    await user.see({ text: /1 of 1 files indexed/ });
    evidence.recordAssertionEvidence(
      "Attached bases join the project union",
      "Attaching surfaces the base's files under its name and the ready gate opens over the union.",
      true,
    );
  });

  await step("detach and watch the gate drop", async () => {
    await user.click({ role: "button", text: "Detach" });
    await user.see({ text: "Not ready to start simplifying" });
    evidence.recordAssertionEvidence(
      "Detaching hides without deleting",
      "Detaching removes the files from the project view and the gate drops; the base itself survives.",
      true,
    );
  });

  await step("delete the file from its base", async () => {
    await navigate(world.app.client, `${world.app.webUrl}/research/knowledge`);
    await user.click({ role: "button", text: "Open" });
    await user.see({ text: "SOP.txt" });
    await user.click({ role: "button", text: "Delete" });
    await user.click({ role: "button", text: "Confirm delete" });
    await user.see({ text: "No files yet." });
    await user.notSee({ text: "SOP.txt" });
    evidence.recordAssertionEvidence(
      "Files delete with confirmation",
      "Deleting removes the file from its base after an explicit confirm step.",
      true,
    );
  });
});
