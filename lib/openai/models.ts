// Use `||` (not `??`) so that empty-string env vars (e.g. `OPENAI_*_MODEL=`
// left blank in .env.local) fall back to the defaults instead of becoming "".
export const MODELS = {
  // Cheap model for the Discovery chat.
  DISCOVERY: process.env.OPENAI_DISCOVERY_MODEL || "gpt-4o-mini",
  // Strong reasoning model for the Builder (template parameter filling).
  BUILDER: process.env.OPENAI_BUILDER_MODEL || "gpt-5.5",
} as const;
