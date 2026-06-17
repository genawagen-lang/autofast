"use client";

// Chat screen — discover what the user wants to automate.
// Streams from POST /api/chat (SSE). When a spec_ready event fires,
// shows an AI Understanding summary card with an Approve button.

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { SpecCard } from "@/components/chat/SpecCard";
import { WorkflowSpec } from "@/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export default function NewWorkflowPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! Tell me what you'd like to automate. For example: \"Every time someone fills out my Google Form, send them a confirmation email and add their details to a spreadsheet.\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [spec, setSpec] = useState<WorkflowSpec | null>(null);
  const [specId, setSpecId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);

    // Add user message
    const userMsgId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: text },
    ]);

    // Prepare assistant placeholder
    const assistantMsgId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: "assistant", content: "", streaming: true },
    ]);

    // Build conversation history for the API
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    history.push({ role: "user", content: text });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new Error(
          "Please sign in to build an automation. Visit /login to continue."
        );
      }

      if (!response.ok || !response.body) {
        throw new Error("Could not reach the assistant. Please try again.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // Plain text delta — append to message
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + raw }
                  : m
              )
            );
            continue;
          }

          const event = parsed as Record<string, unknown>;

          if (event.type === "spec_ready") {
            // Discovery complete — show approval card
            const arrivedSpec = event.spec as WorkflowSpec;
            const arrivedSpecId = event.specId as string;
            setSpec(arrivedSpec);
            setSpecId(arrivedSpecId);
            // Stop streaming indicator
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, streaming: false } : m
              )
            );
          } else if (
            event.type === "delta" ||
            event.type === "token" ||
            event.delta
          ) {
            // Token delta — Discovery emits { type: "delta", text }
            const token =
              (event.text as string) ??
              (event.token as string) ??
              (event.delta as string) ??
              "";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + token }
                  : m
              )
            );
          } else if (event.type === "message") {
            // Full message replacement
            const content = (event.content as string) ?? "";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content } : m
              )
            );
          } else if (event.type === "error") {
            // Discovery emits { type: "error", message }
            const errMsg =
              (event.message as string) ??
              "The assistant ran into a problem. Please try again.";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: errMsg, streaming: false }
                  : m
              )
            );
          }
        }
      }

      // Done streaming — remove streaming indicator
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, streaming: false } : m
        )
      );
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      const msg =
        err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: msg, streaming: false }
            : m
        )
      );
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  async function handleApprove() {
    if (!specId || approving) return;
    setApproving(true);
    try {
      const res = await fetch("/api/orchestrator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specId, action: "approve" }),
      });
      if (!res.ok) throw new Error("Failed to start build");
      router.push(`/workflows/${specId}`);
    } catch {
      setApproving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Create an automation</h1>
        <p className="text-sm text-muted-foreground">
          Describe what you want to automate in plain English.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full">
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            streaming={msg.streaming}
          />
        ))}

        {/* AI Understanding card — shown once spec_ready fires */}
        {spec && (
          <SpecCard
            spec={spec}
            onApprove={handleApprove}
            approving={approving}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area — hidden once spec approved and navigating away */}
      {!approving && (
        <div className="border-t bg-background px-6 py-4">
          <div className="max-w-2xl mx-auto flex gap-3 items-end">
            <Textarea
              placeholder="Describe your automation…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={2}
              className="resize-none flex-1"
            />
            <Button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              className="shrink-0"
            >
              {sending ? "Thinking…" : "Send"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      )}
    </div>
  );
}
