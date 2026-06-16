export const MODELS = {
  DISCOVERY:
    process.env.ANTHROPIC_DISCOVERY_MODEL ?? "claude-haiku-4-5-20251001",
  BUILDER: process.env.ANTHROPIC_BUILDER_MODEL ?? "claude-sonnet-4-6",
} as const;
