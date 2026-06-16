"use client";

import { WorkflowSpec } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Map action types to human-friendly labels
const ACTION_LABELS: Record<string, string> = {
  google_sheets_append: "Save to Google Sheets",
  send_email: "Send an email",
  telegram_send: "Send a Telegram message",
};

// Map trigger types to human-friendly labels
const TRIGGER_LABELS: Record<string, string> = {
  webhook: "When a form is submitted",
  schedule: "On a schedule",
  email: "When an email arrives",
};

// Map credentials to user-friendly account names
const CREDENTIAL_LABELS: Record<string, string> = {
  google_sheets: "Google Sheets",
  google_drive: "Google Drive",
  send_email: "Email (Gmail)",
  telegram: "Telegram bot",
};

// Simple cost heuristic based on number of actions
function estimateCost(spec: WorkflowSpec): string {
  const actionCount = spec.actions.length;
  if (actionCount <= 1) return "~$0/mo (free tier)";
  if (actionCount <= 3) return "~$0–5/mo";
  return "~$5–15/mo";
}

interface SpecCardProps {
  spec: WorkflowSpec;
  onApprove: () => void;
  approving: boolean;
}

export function SpecCard({ spec, onApprove, approving }: SpecCardProps) {
  const triggerLabel =
    TRIGGER_LABELS[spec.trigger.type] ?? spec.trigger.type;

  const actionLabels = spec.actions.map(
    (a) => ACTION_LABELS[a.type] ?? a.type
  );

  const accountLabels = spec.required_credentials
    .map((c) => CREDENTIAL_LABELS[c] ?? c)
    .filter(Boolean);

  return (
    <Card className="border-primary/30 bg-primary/5 mt-4">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{spec.title}</CardTitle>
          <Badge variant="outline" className="shrink-0 text-xs">
            AI Understanding
          </Badge>
        </div>
        <CardDescription className="text-sm leading-relaxed">
          {spec.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {/* Trigger */}
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-1">
            What starts it
          </p>
          <p>{triggerLabel}</p>
        </div>

        {/* Actions */}
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-1">
            What it does
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            {actionLabels.map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ul>
        </div>

        {/* Accounts needed */}
        {accountLabels.length > 0 && (
          <div>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-1">
              Accounts needed
            </p>
            <div className="flex flex-wrap gap-1.5">
              {accountLabels.map((label, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {label}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Cost estimate */}
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-1">
            Estimated cost
          </p>
          <p className="text-muted-foreground">{estimateCost(spec)}</p>
        </div>
      </CardContent>

      <CardFooter>
        <Button
          onClick={onApprove}
          disabled={approving}
          className="w-full"
        >
          {approving ? "Setting up your automation…" : "Approve & build this"}
        </Button>
      </CardFooter>
    </Card>
  );
}
