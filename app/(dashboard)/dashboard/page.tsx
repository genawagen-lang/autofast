import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusPill } from "@/components/workflow/StatusPill";
import { DeploymentRow } from "@/types";

// Import from lib/db — provided by sibling agent (Wave 1A).
// If the module isn't resolved at compile time, the page degrades gracefully.
let listDeployments: ((userId: string) => Promise<DeploymentRow[]>) | null =
  null;
try {
  // Dynamic require so a missing module doesn't crash the file at parse time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const db = require("@/lib/db");
  listDeployments = db.listDeployments;
} catch {
  // lib/db not yet available (sibling in progress) — graceful empty state
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Load deployments — fall back to empty list if lib/db is unavailable
  let deployments: DeploymentRow[] = [];
  if (listDeployments) {
    try {
      deployments = await listDeployments(user.id);
    } catch {
      // DB unavailable in dev — show empty state
    }
  }

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Your automations</h1>
          <div className="flex items-center gap-4">
            <Link href="/connections">
              <Button variant="ghost" size="sm">
                Connections
              </Button>
            </Link>
            <span className="text-sm text-muted-foreground">{user.email}</span>
            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>

        {/* Create CTA */}
        <div className="mb-6">
          <Link href="/new">
            <Button>Create automation</Button>
          </Link>
        </div>

        {/* Workflow list */}
        {deployments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed rounded-lg">
            <p className="text-muted-foreground">No automations yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first automation to get started.
            </p>
            <Link href="/new" className="mt-4">
              <Button variant="outline" size="sm">
                Create automation
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {deployments.map((deployment) => (
              <Link
                key={deployment.id}
                href={`/workflows/${deployment.spec_id}`}
                className="block"
              >
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      {/* spec_id used as display name fallback until spec is loaded */}
                      <CardTitle className="text-base">
                        Automation {deployment.spec_id.slice(0, 8)}
                      </CardTitle>
                      <StatusPill status={deployment.status} />
                    </div>
                    {deployment.last_run && (
                      <CardDescription>
                        Last run:{" "}
                        {new Date(deployment.last_run).toLocaleString()}
                      </CardDescription>
                    )}
                  </CardHeader>

                  {/* Plain-language error if present */}
                  {deployment.status === "error" && deployment.last_error && (
                    <CardContent>
                      <p className="text-sm text-destructive">
                        {deployment.last_error}
                      </p>
                    </CardContent>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
