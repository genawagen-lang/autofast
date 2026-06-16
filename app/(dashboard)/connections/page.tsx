"use client";

// Connections screen — shows which accounts are linked.
// Google OAuth via /api/credentials/google/start.
// Telegram bot token pasted in a dialog → POST /api/credentials/telegram.

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Each integration we surface to the user
interface Integration {
  id: string;
  name: string;
  description: string;
  provider: string; // matches CredentialRow.provider
  connectType: "oauth" | "token";
}

const INTEGRATIONS: Integration[] = [
  {
    id: "google",
    name: "Google (Sheets & Gmail)",
    description:
      "Read and write to Google Sheets, and send emails from your Gmail account.",
    provider: "google_sheets", // canonical; callback also saves send_email
    connectType: "oauth",
  },
  {
    id: "telegram",
    name: "Telegram",
    description:
      "Send messages to a Telegram chat or channel via your own bot.",
    provider: "telegram",
    connectType: "token",
  },
];

interface CredentialStatus {
  provider: string;
  connected: boolean;
}

export default function ConnectionsPage() {
  const [statuses, setStatuses] = useState<CredentialStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramSuccess, setTelegramSuccess] = useState(false);

  async function loadStatuses() {
    try {
      const res = await fetch("/api/credentials/status");
      if (res.ok) {
        const data = (await res.json()) as CredentialStatus[];
        setStatuses(data);
      }
    } catch {
      // Graceful degradation — show "Not connected" for all
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatuses();

    // Check for ?connected=google notice from OAuth callback redirect
    const params = new URLSearchParams(window.location.search);
    const notice = params.get("notice");
    if (notice) {
      // Show the notice briefly; URL stays clean after reload
      // Simple approach: reload statuses (already done) + clear param
      window.history.replaceState({}, "", "/connections");
    }
  }, []);

  function isConnected(provider: string) {
    return statuses.some((s) => s.provider === provider && s.connected);
  }

  function handleGoogleConnect() {
    window.location.href = "/api/credentials/google/start";
  }

  async function handleTelegramSave() {
    if (!telegramToken.trim()) return;
    setTelegramSaving(true);
    setTelegramError(null);
    try {
      const res = await fetch("/api/credentials/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: telegramToken.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTelegramError(data.error ?? "Could not connect. Please check the bot token and try again.");
      } else {
        setTelegramSuccess(true);
        setTelegramToken("");
        await loadStatuses();
        setTimeout(() => {
          setTelegramOpen(false);
          setTelegramSuccess(false);
        }, 1500);
      }
    } catch {
      setTelegramError("Connection failed. Please try again.");
    } finally {
      setTelegramSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Connected accounts</h1>
          <p className="text-muted-foreground mt-1">
            Link your accounts so your automations can act on your behalf.
          </p>
        </div>

        <div className="space-y-4">
          {INTEGRATIONS.map((integration) => {
            const connected =
              !loading && isConnected(integration.provider);

            return (
              <Card key={integration.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {integration.name}
                    </CardTitle>
                    {loading ? (
                      <Badge variant="outline" className="text-xs">
                        Checking…
                      </Badge>
                    ) : connected ? (
                      <Badge className="text-xs bg-green-600 text-white hover:bg-green-600">
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Not connected
                      </Badge>
                    )}
                  </div>
                  <CardDescription>{integration.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {connected ? (
                    <p className="text-sm text-muted-foreground">
                      Your account is linked. You can reconnect at any time.
                    </p>
                  ) : integration.connectType === "oauth" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGoogleConnect}
                    >
                      Connect with Google
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTelegramOpen(true);
                        setTelegramError(null);
                        setTelegramSuccess(false);
                      }}
                    >
                      Connect Telegram bot
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Telegram token dialog */}
      <Dialog open={telegramOpen} onOpenChange={setTelegramOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect your Telegram bot</DialogTitle>
            <DialogDescription>
              Paste your bot token from{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                @BotFather
              </a>
              . We&apos;ll verify it and keep it safe.
            </DialogDescription>
          </DialogHeader>

          {telegramSuccess ? (
            <p className="text-sm text-green-600 py-2">
              Telegram connected successfully!
            </p>
          ) : (
            <div className="space-y-3 py-2">
              <Input
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                disabled={telegramSaving}
              />
              {telegramError && (
                <p className="text-sm text-destructive">{telegramError}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTelegramOpen(false)}
              disabled={telegramSaving}
            >
              Cancel
            </Button>
            {!telegramSuccess && (
              <Button
                onClick={handleTelegramSave}
                disabled={telegramSaving || !telegramToken.trim()}
              >
                {telegramSaving ? "Connecting…" : "Connect"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
