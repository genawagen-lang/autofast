import { Badge } from "@/components/ui/badge";
import { DeploymentRow } from "@/types";

// Maps raw deployment status to a friendly label + badge variant
const STATUS_CONFIG: Record<
  DeploymentRow["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Setting up", variant: "secondary" },
  active: { label: "Live", variant: "default" },
  stopped: { label: "Paused", variant: "outline" },
  error: { label: "Problem", variant: "destructive" },
};

interface StatusPillProps {
  status: DeploymentRow["status"];
}

export function StatusPill({ status }: StatusPillProps) {
  const { label, variant } = STATUS_CONFIG[status] ?? {
    label: status,
    variant: "secondary" as const,
  };

  return <Badge variant={variant}>{label}</Badge>;
}
