# AGENTS.md

OpenWork: MIT-licensed local-first desktop app (macOS/Windows/Linux) for agent work on own files, built on OpenCode, any model via 50+ providers/BYOK/Ollama. Cloud optional. Three surfaces:

* **Desktop app** (`apps/`, `packages/`, MIT) — chat on files, skills, browser automation, scheduled automations, Anthropic-compatible plugins. `apps/app` = React UI, `apps/desktop` = Electron shell, `apps/server` = `openwork-server` (actual chat runtime).
* **MCP gateway** (`ee/apps/den-api`, EE) — one URL (`api.openworklabs.com/mcp/agent`): org skills/plugins/connections (Google Workspace, Microsoft 365, MCPs) into any MCP client via `search_capabilities` / `execute_capability` (`list_skills` / `get_skill` for skills).
* **Den control plane** (`ee/apps/den-*`, EE) — provision inference, teams/access, desktop policies, skill/plugin marketplaces.

App consumes server surfaces rather than inventing parallel behavior. Anything OpenCode can do is available in OpenWork even before dedicated UI exists.

## Confidentiality (hard rule — repo public)

Never let branch name, commit, PR text, comment, fixture, or evidence identify customer/prospect/partner/outside person; use internal ticket IDs, escalate leaks instead of rewriting history.

## Setup and dev

* Node 24 (`nvm use`, pinned in `.nvmrc`), pnpm 11 (pinned `packageManager`, `corepack enable`). pnpm only, never npm/yarn.
* First run: `corepack enable && pnpm install && pnpm dev` (Electron desktop, hot reload, `OPENWORK_DEV_MODE=1`).
* Multiple checkouts: `pnpm dev:worktree` (`OPENWORK_DEV_PROFILE=auto`, free CDP/Vite ports, mock keychain). Banner `[openwork] dev profile=... cdp=...` gives profile/CDP; second instance on locked profile exits instead of lingering.
* Headless web (no Electron): `pnpm world up dev-app-web --detach`.
* Single package: `pnpm --filter <pkg> <script>` (e.g. `pnpm --filter @openwork/app typecheck`, `pnpm --filter @openwork/features test`).

## Generated contracts (never hand-edit)

Changing Den routes, shared schemas, or `packages/features/src/registry.ts` requires `pnpm features:sync` (regenerates Helm feature block, then runs `den:contract`) and committing `packages/docs/openapi.json` + `packages/sdk/src/gen/**` in same commit. Contract DB is disposable local MySQL (`pnpm dev:den:mysql`); never uses `DATABASE_URL` (only `OPENWORK_CONTRACT_MYSQL_URL` for alternate localhost creds). After merging/rebasing `dev`, regenerate conflicted generated files instead of picking sides. `pnpm hooks:install` pre-commit hook is optional; CI authoritative.

## Testing (skills own mechanics)

`evals/` is standalone pnpm workspace: `pnpm --dir evals install` once. Then `pnpm evals:pr specs/<name>.test.ts` (app-less lane), `pnpm evals:e2e <slug> [--local]` (app-driving journey; CLI prints `placement: ... (reason)`, copy into report). `pnpm evals:typecheck` must exit 0 before pushing. Skill order: `write-a-spec` → `run-tests` → `diagnose-a-red-run` on failure → `open-a-pr`; `fix-design-notes` for Evidence design notes, `get-env-var` for missing secrets. See `evals/README.md` for world/placement vocabulary.

* Every PR to `dev` (default branch) gets: unit+build (`ci-tests.yml`), core journey `specs/core-chat.e2e.test.ts` + changed specs (`pr-proof.yml`), PR preview card. App runs in world (Freestyle VM), not runner; `HOT_RULES` (`packages/freestyle/src/evidence-builder.ts`) picks reuse/copy/rebuild — slower never red.
* Local Den needs MySQL (`pnpm dev:den:mysql` at `127.0.0.1:3306`) plus `pnpm --filter @openwork/types build`, `... den-db ...`, `... email ...` first, else `den-api` imports fail.
* Checkout path with spaces breaks node-gyp/electron-rebuild: set `OPENWORK_EVAL_SURFACES_DIR` to space-free path before E2E.

## Coding

* TypeScript: never `any`, typecasts, or `as` unless 100% necessary or instructed. Prefer Tailwind, React, shadcn/ui (Base UI), TanStack Query, Zustand, Zod, Drizzle, Better-Auth. Reuse `@/components`; end users non-technical.
* User-visible feature/change → declare off in `packages/features/src/registry.ts` before code, keep safe to turn off, roll out from `/admin`. Follow `.opencode/skills/add-a-feature` (dimensions: deployments → kill switch → operator lock → org override → everyone).
* User-facing UI (`apps/app`, `apps/desktop`, `ee/apps/den-web`, MCP Apps, artifact views): read `DESIGN.md` first, cite rule ids in PRs, attach real-size screenshot/recording (P10: no evidence, no review).
* Licensing contributions: outside `ee/` = DCO + MIT; inside `ee/` = CLA (individual/corporate per contributor) under EE License (each release converts to MIT 2y after publication). See `CONTRIBUTING.md`, `LICENSE`, `REUSE.toml`.
