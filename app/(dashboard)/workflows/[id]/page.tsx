"use client";

// Test → Deploy view for a single workflow.
// Drives the orchestrator to advance through Build → Connect → Test → Deploy.
// Shows a stepper, test results (PASS/FAIL), and a final "Approve & Deploy" button.

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkflowStepper, Step, StepStatus } from "@/components/workflow/WorkflowStepper";
import { WorkflowSpec } from "@/types";

// What the orchestrator actually returns (WorkflowSpec statuses + detail).
interface OrchestratorResponse {
  status:
    | "draft" // build in progress
    | "needs_credentials"
    | "testing"
    | "ready"
    | "deployed"
    | "error";
  detail?: string; // preview text on ready; failure reason on error
}

// Map orchestrator status → which stepper step is active/done/error
function buildSteps(
  status: OrchestratorResponse["status"] | null,
  detail?: string
): Step[] {
  function stepStatus(
    phase: "build" | "connect" | "test" | "deploy"
  ): StepStatus {
    if (!status) return "pending";

    if (status === "error") {
      // Build/connect completed; the test step is where it failed; deploy pending.
      if (phase === "deploy") return "pending";
      if (phase === "test") return "error";
      return "done";
    }
    if (status === "deployed") return "done";
    if (status === "ready") {
      // Everything passed; waiting for the user to approve & deploy.
      return phase === "deploy" ? "active" : "done";
    }

    const order = ["build", "connect", "test", "deploy"];
    const phaseOf: Record<string, "build" | "connect" | "test" | "deploy"> = {
      draft: "build",
      needs_credentials: "connect",
      testing: "test",
    };
    const currentIndex = order.indexOf(phaseOf[status] ?? "build");
    const phaseIndex = order.indexOf(phase);
    if (phaseIndex < currentIndex) return "done";
    if (phaseIndex === currentIndex) return "active";
    return "pending";
  }

  return [
    {
      id: "build",
      label: "Building your automation",
      description: "We're setting up the workflow behind the scenes.",
      status: stepStatus("build"),
    },
    {
      id: "connect",
      label: "Connect your accounts",
      description:
        status === "needs_credentials"
          ? "Some accounts need to be linked before we can test. Go to Connections."
          : "Making sure your accounts are linked.",
      status: stepStatus("connect"),
    },
    {
      id: "test",
      label: "Running a test",
      description: "We're doing a safe dry-run to make sure everything works.",
      status: stepStatus("test"),
      errorMessage: status === "error" ? detail : undefined,
    },
    {
      id: "deploy",
      label: "Going live",
      description: "Your automation is active and running.",
      status: stepStatus("deploy"),
    },
  ];
}

// Human-friendly label for each trigger type
const TRIGGER_LABELS: Record<string, string> = {
  webhook: "When a form or webhook fires",
  schedule: "On a schedule",
  email: "When an email arrives",
};

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const specId = params.id as string;

  const [spec, setSpec] = useState<WorkflowSpec | null>(null);
  const [orchStatus, setOrchStatus] = useState<OrchestratorResponse | null>(null);
  const [polling, setPolling] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the spec
  useEffect(() => {
    async function loadSpec() {
      try {
        const res = await fetch(`/api/spec/${specId}`);
        if (res.ok) {
          const data = (await res.json()) as { spec?: WorkflowSpec };
          if (data.spec) setSpec(data.spec);
        }
      } catch {
        // Keep null — graceful empty state
      }
    }
    if (specId) loadSpec();
  }, [specId]);

  // Advance orchestrator and poll for status
  const advance = useCallback(
    async (action?: string) => {
      if (polling) return;
      setPolling(true);
      setError(null);
      try {
        const res = await fetch("/api/orchestrator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ specId, action }),
        });
        if (!res.ok) throw new Error("Could not reach the orchestrator.");
        const data = (await res.json()) as OrchestratorResponse;
        setOrchStatus(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Something went wrong."
        );
      } finally {
        setPolling(false);
      }
    },
    [specId, polling]
  );

  // Kick off orchestrator on mount
  useEffect(() => {
    advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specId]);

  // Auto-poll while a transient in-progress status is showing.
  useEffect(() => {
    const liveStatuses = new Set(["draft", "testing"]);
    if (!orchStatus || !liveStatuses.has(orchStatus.status)) return;

    const timer = setTimeout(() => advance(), 3000);
    return () => clearTimeout(timer);
  }, [orchStatus, advance]);

  async function handleDeploy() {
    setDeploying(true);
    setError(null);
    try {
      // Deploy is handled by the dedicated deploy route (spec must be "ready").
      const res = await fetch(`/api/spec/${specId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Deploy failed");
      }
      setOrchStatus({ status: "deployed" });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Deployment failed. Please try again."
      );
    } finally {
      setDeploying(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    await advance("retry");
    setRetrying(false);
  }

  // Show the build step as active while the very first advance is in flight.
  const displayStatus: OrchestratorResponse["status"] | null =
    orchStatus?.status ?? (polling ? "draft" : null);

  const steps = buildSteps(displayStatus, orchStatus?.detail);

  const isDeployed = orchStatus?.status === "deployed";
  const isReady = orchStatus?.status === "ready";
  const isError = orchStatus?.status === "error";
  const needsCredentials = orchStatus?.status === "needs_credentials";

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {spec?.title ?? "Your automation"}
            </h1>
            {spec?.description && (
              <p className="text-muted-foreground mt-1">{spec.description}</p>
            )}
          </div>
          {isDeployed && (
            <Badge className="bg-green-600 text-white hover:bg-green-600 shrink-0">
              Live
            </Badge>
          )}
        </div>

        {/* Spec summary */}
        {spec && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                What it does
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="font-medium">Starts when: </span>
                {TRIGGER_LABELS[spec.trigger.type] ?? spec.trigger.type}
              </div>
              <div>
                <span className="font-medium">Then: </span>
                {spec.actions
                  .map((a) => {
                    const labels: Record<string, string> = {
                      google_sheets_append: "saves to Google Sheets",
                      send_email: "sends an email",
                      telegram_send: "sends a Telegram message",
                    };
                    return labels[a.type] ?? a.type;
                  })
                  .join(", ")}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progress stepper */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
            <CardDescription>
              {isDeployed
                ? "Your automation is live and running."
                : "We're getting your automation ready."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkflowStepper steps={steps} />
          </CardContent>
        </Card>

        {/* Error banner */}
        {error && (
          <div className="p-3 rounded bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Test PASS result */}
        {isReady && orchStatus?.detail && (
          <Card className="border-green-600/30 bg-green-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-green-700">
                Test passed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {orchStatus.detail}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Error result */}
        {isError && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-destructive">
                We couldn&apos;t finish setting this up
              </CardTitle>
              <CardDescription>
                {orchStatus?.detail ??
                  "Something went wrong while building or testing this automation."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
                disabled={retrying}
              >
                {retrying ? "Trying again…" : "Try again"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Needs credentials notice */}
        {needsCredentials && (
          <Card className="border-amber-400/40 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-700">
                Accounts needed
              </CardTitle>
              <CardDescription>
                Some accounts aren&apos;t linked yet. Connect them first, then come
                back here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/connections")}
              >
                Go to Connections
              </Button>
            </CardContent>
          </Card>
        )}

        {/* CTA buttons */}
        <div className="flex gap-3">
          {isReady && !isDeployed && (
            <Button onClick={handleDeploy} disabled={deploying} className="w-full">
              {deploying ? "Deploying…" : "Approve & deploy"}
            </Button>
          )}

          {isDeployed && (
            <Button
              variant="outline"
              onClick={() => router.push("/dashboard")}
              className="w-full"
            >
              Back to dashboard
            </Button>
          )}
        </div>

        {/* Live success banner */}
        {isDeployed && (
          <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-center">
            <p className="text-lg font-semibold text-green-700">Live</p>
            <p className="text-sm text-green-600 mt-1">
              Your automation is active. You can manage it from the dashboard.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
