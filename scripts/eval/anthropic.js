// Claude calls for the eval scripts, through the official Anthropic SDK. Card completions use the
// same request shape as the extension (copilot-core.js getClaudeRequestShape), so the eval
// measures what users get.

const COPILOT_CORE = require("../../copilot-core.js");

let clientCache = null;

function getClient(config) {
  if (clientCache && clientCache.key === config.apiKey && clientCache.baseUrl === config.baseUrl) {
    return clientCache.client;
  }
  const sdk = require("@anthropic-ai/sdk");
  const Anthropic = sdk.default || sdk.Anthropic;
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl || undefined, maxRetries: 3 });
  clientCache = { key: config.apiKey, baseUrl: config.baseUrl, client };
  return client;
}

function toUsage(usage) {
  if (!usage) return null;
  return {
    inputTokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
    outputTokens: usage.output_tokens || 0,
  };
}

// Build the request body for a model, with server-side fallbacks on Anthropic's API where the
// model takes them. Returns { body, beta } where beta says whether to use the beta endpoint.
// purpose "completion" mirrors the extension (thinking off where possible, low effort);
// "judge" leaves the model's own thinking on and sets the effort asked for.
function buildRequest(config, { system, prompt, maxTokens, effort, outputFormat, purpose = "completion" }) {
  const shape = COPILOT_CORE.getClaudeRequestShape(config.model, maxTokens);
  const isCurrentGeneration = /^claude-(?:opus|sonnet|haiku|fable|mythos)-5/i.test(String(config.model || ""));
  const body = {
    model: config.model,
    max_tokens: purpose === "judge" ? Math.max(Number(maxTokens) || 0, 8000) : shape.maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  };
  const outputConfig = {};
  if (purpose === "judge") {
    if (effort && isCurrentGeneration) outputConfig.effort = effort;
  } else {
    if (shape.thinking) body.thinking = shape.thinking;
    if (shape.effort) outputConfig.effort = shape.effort;
  }
  if (outputFormat) outputConfig.format = outputFormat;
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;
  const onAnthropicApi = !config.baseUrl || /^https:\/\/api\.anthropic\.com\/?$/i.test(config.baseUrl);
  if (shape.fallbacks && onAnthropicApi) {
    body.fallbacks = "default";
    body.betas = ["server-side-fallback-2026-07-01"];
    return { body, beta: true };
  }
  return { body, beta: false };
}

async function sendMessage(config, request) {
  const client = getClient(config);
  const { body, beta } = buildRequest(config, request);
  const response = beta ? await client.beta.messages.create(body) : await client.messages.create(body);
  return response;
}

// A card completion: returns { text, model, usage } like the runner's other providers.
async function anthropicCompletion(config, { system, prompt, maxTokens }) {
  const response = await sendMessage(config, { system, prompt, maxTokens });
  return {
    text: COPILOT_CORE.getClaudeReplyText(response),
    model: String(response?.model || config.model || ""),
    usage: toUsage(response?.usage),
    stopReason: response?.stop_reason || "",
  };
}

// A JSON reply constrained to a schema (used by the judge).
async function anthropicJson(config, { system, prompt, schema, maxTokens = 8000, effort = "medium" }) {
  const response = await sendMessage(config, {
    system,
    prompt,
    maxTokens,
    effort,
    purpose: "judge",
    outputFormat: { type: "json_schema", schema },
  });
  const text = COPILOT_CORE.getClaudeReplyText(response);
  let value = null;
  try { value = JSON.parse(text); } catch {}
  return { value, text, model: String(response?.model || config.model || ""), usage: toUsage(response?.usage), stopReason: response?.stop_reason || "" };
}

module.exports = { buildRequest, anthropicCompletion, anthropicJson, toUsage };
