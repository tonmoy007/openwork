/** @jsxImportSource react */

export function researchPortfolioRoute() {
  return "/research";
}

export function researchNewProjectRoute() {
  return "/research/new";
}

export function researchEvidenceRoute(projectId: string) {
  return `/research/${encodeURIComponent(projectId)}/evidence`;
}
