/** @jsxImportSource react */
import type { ReactNode } from "react";

/**
 * Scroll contract for research pages: fills a bounded shell and scrolls
 * inside it, or grows with the document when unbounded. Either way the
 * content stays reachable no matter how long pastes or file lists get.
 *
 * The app root locks document scrolling (html/body/#root overflow hidden),
 * so every research route mounts inside this region. Do not render research
 * content outside it.
 */
export function ResearchPageShell({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="h-dvh min-h-0 overflow-y-auto">{children}</div>;
}
