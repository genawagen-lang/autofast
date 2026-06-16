import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared JSON type alias
// ---------------------------------------------------------------------------
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

// ---------------------------------------------------------------------------
// WorkflowSpec — authoritative contract; all agents validate against this
// ---------------------------------------------------------------------------
export const workflowSpecSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  trigger: z.object({
    type: z.enum(["webhook", "schedule", "email"]),
    config: z.record(z.string(), z.unknown()),
  }),
  actions: z.array(
    z.object({
      type: z.enum(["google_sheets_append", "send_email", "telegram_send"]),
      config: z.record(z.string(), z.unknown()),
    })
  ),
  required_credentials: z.array(z.string()),
  template_id: z.string(),
  status: z.enum([
    "draft",
    "needs_credentials",
    "testing",
    "ready",
    "deployed",
    "error",
  ]),
});

export type WorkflowSpec = z.infer<typeof workflowSpecSchema>;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  user_id: string;
  messages: Json[];
  created_at: string;
}

export interface WorkflowSpecRow {
  id: string;
  user_id: string;
  version: number;
  spec: Json; // WorkflowSpec stored as JSON
  status: WorkflowSpec["status"];
  created_at: string;
}

export interface CredentialRow {
  id: string;
  user_id: string;
  provider: string;
  encrypted_token: string; // reference to vault entry
  status: "active" | "revoked" | "expired";
  created_at: string;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string;
  trigger_type: "webhook" | "schedule" | "email";
  action_types: string[];
  n8n_json_template: Json;
}

export interface DeploymentRow {
  id: string;
  spec_id: string;
  n8n_workflow_id: string;
  status: "pending" | "active" | "stopped" | "error";
  last_run: string | null;
  last_error: string | null;
}
