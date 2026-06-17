import OpenAI from "openai";

// The OpenAI SDK throws at construction time when no API key is present. To keep
// the app booting/building without keys (the route handlers surface a friendly
// error at request time instead), the client is constructed lazily on first use
// rather than at module load.
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
