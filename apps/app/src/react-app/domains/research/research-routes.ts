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

export function researchAsisRoute(projectId: string) {
  return `/research/${encodeURIComponent(projectId)}/asis`;
}

export function researchSimplifyRoute(projectId: string) {
  return `/research/${encodeURIComponent(projectId)}/simplify`;
}

export function researchTobeRoute(projectId: string) {
  return `/research/${encodeURIComponent(projectId)}/tobe`;
}
