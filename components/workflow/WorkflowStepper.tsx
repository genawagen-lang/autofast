"use client";

// Stepper component for the Build → Connect → Test → Deploy flow.
// Each step shows its status clearly without technical jargon.

export type StepStatus = "pending" | "active" | "done" | "error";

export interface Step {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
  errorMessage?: string;
}

interface WorkflowStepperProps {
  steps: Step[];
}

const statusIcon: Record<StepStatus, string> = {
  pending: "○",
  active: "◎",
  done: "✓",
  error: "✕",
};

const statusColor: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  active: "text-primary",
  done: "text-green-600",
  error: "text-destructive",
};

const statusBg: Record<StepStatus, string> = {
  pending: "bg-muted border-muted-foreground/30",
  active: "bg-primary/10 border-primary animate-pulse",
  done: "bg-green-50 border-green-600",
  error: "bg-destructive/10 border-destructive",
};

export function WorkflowStepper({ steps }: WorkflowStepperProps) {
  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div key={step.id} className="flex gap-4">
          {/* Left — step number + connector line */}
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold ${statusBg[step.status]} ${statusColor[step.status]}`}
            >
              {statusIcon[step.status]}
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-0.5 flex-1 mt-1 ${
                  step.status === "done" ? "bg-green-600" : "bg-border"
                }`}
              />
            )}
          </div>

          {/* Right — label + description */}
          <div className="flex-1 pb-4">
            <p
              className={`font-medium text-sm ${statusColor[step.status]}`}
            >
              {step.label}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {step.description}
            </p>
            {step.status === "error" && step.errorMessage && (
              <p className="text-xs text-destructive mt-1 p-2 bg-destructive/10 rounded">
                {step.errorMessage}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
