/**
 * POST /api/chat
 *
 * Streaming chat endpoint for the Discovery Agent.
 * Accepts a JSON body, returns a text/event-stream (SSE) response.
 *
 * Request body shape:
 *   { userId: string; conversationId?: string; messages: {role: "user"|"assistant"; content: string}[] }
 *
 * SSE event shapes — see lib/agents/discovery.README.md for full details.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { runDiscoveryStream } from "@/lib/agents/discovery";

// ---------------------------------------------------------------------------
// Request validation schema
// ---------------------------------------------------------------------------

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const chatRequestSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  conversationId: z.string().uuid().optional(),
  messages: z
    .array(chatMessageSchema)
    .min(1, "At least one message is required"),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Parse and validate the request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  const { userId, conversationId, messages } = parsed.data;

  // Build the streaming response
  const stream = runDiscoveryStream({ userId, conversationId, messages });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Allow the client to read the stream cross-origin if needed
      "X-Accel-Buffering": "no",
    },
  });
}

// Disallow other methods
export async function GET() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
