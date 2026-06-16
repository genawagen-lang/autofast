"use client";

// Renders a single chat bubble — assistant or user.
export interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  /** True while the assistant is still streaming this message */
  streaming?: boolean;
}

export function ChatMessage({ role, content, streaming }: ChatMessageProps) {
  const isAssistant = role === "assistant";

  return (
    <div className={`flex ${isAssistant ? "justify-start" : "justify-end"} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isAssistant
            ? "bg-muted text-foreground"
            : "bg-primary text-primary-foreground"
        }`}
      >
        {content}
        {streaming && (
          <span className="inline-block w-1.5 h-4 ml-1 bg-current opacity-70 animate-pulse align-middle" />
        )}
      </div>
    </div>
  );
}
