/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Page-level back navigation, repo standard (automations pattern): always a
 * known route, never history-back. Labels name the destination.
 */
export function ResearchBack({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Back to ${label}`}
      title={`Back to ${label}`}
      onClick={() => navigate(to)}
    >
      <ArrowLeft className="size-4" />
    </Button>
  );
}
export function ResearchPageShell({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="h-dvh min-h-0 overflow-y-auto">{children}</div>;
}
