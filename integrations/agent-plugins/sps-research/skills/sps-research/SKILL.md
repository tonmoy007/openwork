---
name: sps-research
description: Run a simplification research project against the local OpenWork server — create projects from briefs, manage knowledge bases, index evidence, and walk every gate to export. Use when the user asks to simplify a service or research a process.
---

# SPS Research

Do every research task through the local OpenWork server API. The base URL
and token come from the desktop bridge (`openworkServerInfo`) or the
`OPENWORK_SERVER_URL` / `OPENWORK_SERVER_TOKEN` environment. Never ask the
user for tokens, never persist them in files or chat content, and never
invent access: a 404/403 names exactly what is missing.

All routes live under `/research`. JSON unless noted. Every step below is
API-doable — the UI is never required.

## Discover first

1. `GET /research/templates` lists template `id@version` entries. Pick the
   exact ref the project needs; default to the newest `sps-ecrs-v1`.
2. `GET /research/knowledge` lists knowledge bases with scopes. Reuse a
   base before creating one; attach with its exact id.

## Create a project from a brief

`POST /research/projects/from-brief` with `{ "brief": "<service name>\nwhat it does, for whom, and any template: or standard hints" }`.
The server parses deterministically and returns `{ project, assumptions }`.
Read the assumptions back to the user and correct anything it guessed wrong
with `POST /research/projects/:id/assign` (`template_ref`) — do not silently
re-create.

Prefer the brief endpoint over hand-building projects. Use
`POST /research/projects` only when every field is already explicit.

## Knowledge bases

- Create: `POST /research/knowledge` with `{ name, category, scope }`.
  Scope `project` belongs to one engagement; `global` is shared.
- Upload files: `POST /research/knowledge/:id/evidence` as
  multipart/form-data (`file` + `type` fields). Paste text instead with JSON
  `{ name, type, text }`. Anything unreadable returns 422 with a reason and
  stays listed as `failed` for triage — report the reason, do not retry
  blindly.
- Web: search with the `websearch` tool, read with `webfetch`, then
  `POST /research/knowledge/:id/web-capture` with
  `{ url, title?, text, query? }`. Quote passages; the URL travels with
  every claim into drafts, decisions, and exports.
- Attach: `POST /research/projects/:id/knowledge/attach` with `{ kb_id }`.
  Detach keeps the base: `DELETE .../knowledge/:kbId`.

## Walk the gates in order

1. Evidence: `GET /research/projects/:id/evidence` (union over attached
   bases). Proceed only when `gate.ready` is true.
2. As-is: `POST .../asis/draft`, add pains
   (`POST .../asis/steps/:stepId/pains` with cited `claim_ids`) or clear
   steps (`POST .../no-pain` with a reason), suggest gaps
   (`POST .../questions/suggest`), answer or skip every open question, then
   `POST .../asis/confirm`.
3. Simplification: save constraints (`POST .../constraints` with what must
   stay and why — proposals refuse to run without at least one), run
   `POST .../processing/propose`, then decide every step
   (`POST .../processing/steps/:stepId/decide` with
   `accepted | rejected | revised`).
4. To-be: `POST .../tobe/build`, review the variant, then
   `POST .../tobe/approve` (reviewer role, or solo-member projects).
5. Export: `GET .../export` lists hashed files; download each from
   `GET .../export/<tobe.bpmn|asis.bpmn|report.html|decision.html|decisions.xlsx>`
   and verify the sha256 in the manifest.

A 422 names the missing precondition (`no_constraints`, `questions_open`,
`decisions_incomplete`) — fix that step instead of skipping ahead. Hand the
workspace links back in the form `/research/<projectId>/<evidence|asis|simplify|tobe>`.
