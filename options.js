
// options.js (v0.3.2)
const $ = (sel) => document.querySelector(sel);
const DEFAULT_SHORTCUT = "Meta+Shift+A";
const DEFAULT_COPILOT_SHORTCUT = "Cmd+Shift+X";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const ULTIMATE_BASE_URL = "https://smart.ultimateai.org/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_COPILOT_FRONT_PROMPT = `
Autocomplete one Anki Front field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Complete the user's prefix into one durable retrieval cue: one target, unambiguous, enough context, no answer leakage.
Cue, don't disclose: silently identify the minimal Back answer, then write a Front that asks for it without revealing the method, formula, definition, result, name, or example.
If the completion would need "by defining", "using", "where", "namely", or another answer-bearing phrase, stop before that phrase.
Preserve the user's intended target; do not switch to easier source trivia.
`.trim();
const DEFAULT_COPILOT_BACK_PROMPT = `
Autocomplete one Anki Back field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Answer the Front exactly. Prefer the smallest source-grounded phrase.
Supply the missing answer the Front cues; do not turn the Back into a passage summary.
Do not restate the passage or add background unless needed to disambiguate.
`.trim();
const DEFAULT_COPILOT_FRONT_FROM_BACK_PROMPT = `
Autocomplete one Anki Front field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Use the Back as the answer contract. Ask for exactly one target with enough context and no answer leakage.
Cue, don't disclose: the Front must point at the Back answer while leaving that answer missing.
`.trim();
const DEFAULT_EDITOR_FIELD_CONFIG = {
  context: {
    label: "Context",
    visible: true,
    aiPrompt: `Return ONLY valid JSON. You are helping the user author flashcard Context lines.
Task: produce a concise context label (≤6 words) so the learner remembers the source/work.
Prefer the exact work/source name if clear (book/article/video/episode/paper).
Avoid echoing the front/back text; avoid generic paraphrases.`,
  },
  extra: {
    label: "Notes",
    visible: false,
    aiPrompt: "",
  },
  source_excerpt: {
    label: "Source",
    visible: true,
    aiPrompt: "",
  },
  hint: {
    label: "Hint",
    visible: true,
    aiPrompt: "",
  },
};
const PROVIDER_DEFAULTS = {
  ultimate: {
    baseUrl: ULTIMATE_BASE_URL,
    model: "auto",
    keyPlaceholder: "UltimateAI API key",
  },
  openai: {
    baseUrl: DEFAULT_BASE_URL,
    model: "gpt-4.1-mini",
    keyPlaceholder: "OpenAI API key",
  },
  gemini: {
    baseUrl: GEMINI_BASE_URL,
    model: "gemini-2.5-flash-lite",
    keyPlaceholder: "Gemini API key",
  },
  claude: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    keyPlaceholder: "Anthropic API key",
  },
};
const KNOWN_MODELS = {
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  ],
  openai: [
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  ultimate: [
    { id: "auto", label: "Auto (fast default)" },
    { id: "task", label: "Task (low-cost grunt work)" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
    { id: "claude-4-5-haiku", label: "Claude 4.5 Haiku" },
    { id: "claude-latest", label: "Claude latest" },
    { id: "chatgpt-latest", label: "ChatGPT latest" },
    { id: "gemini-latest", label: "Gemini latest" },
    { id: "gpt-5.5-mini", label: "GPT-5.5 Mini" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "claude-4-6-sonnet", label: "Claude 4.6 Sonnet" },
    { id: "claude-4-6-opus", label: "Claude 4.6 Opus" },
    { id: "claude-4-7-opus", label: "Claude 4.7 Opus" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { id: "gemini-3-flash-lite", label: "Gemini 3 Flash Lite" },
    { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    { id: "grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast Non-reasoning" },
    { id: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast Reasoning" },
    { id: "deepseek-v3.2", label: "DeepSeek V3.2" },
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    { id: "glm-4.6", label: "GLM 4.6" },
    { id: "kimi-k2", label: "Kimi K2" },
    { id: "minimax-m2.1", label: "MiniMax M2.1" },
  ],
  claude: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
};
const OPTIONS_KEY = "quickflash_options";
const FREE_TIER_KEY = "ghostwriter_free_tier";
const FREE_TIER_LIMIT = 20;
const FREE_TIER_DAILY_LIMIT = 10;
const UPDATE_NOTICE_KEY = "ghostwriter_update_notice_v1";
const SHORTCUT_COACH_KEY = "ghostwriter_onboarding_v1";
const PERMISSION_JUSTIFICATIONS = {
  clipboardRead: {
    reason:
      "Reads clipboard text to populate the Source field when Clipboard mode is selected or Auto mode has no page selection, including on panel open or Copilot runs without a selection.",
  },
};

let currentOptionsCache = null;

async function renderFreeTierStatus() {
  const el = document.querySelector("#freeTierStatus");
  if (!el) return;
  try {
    const got = await chrome.storage.local.get(FREE_TIER_KEY);
    const state = got?.[FREE_TIER_KEY] || {};
    const today = new Date().toISOString().slice(0, 10);
    const dailyUsed = state.dailyDate === today ? (state.dailyUsed || 0) : 0;
    const lifetimeRemaining = Math.max(0, FREE_TIER_LIMIT - (state.used || 0));
    const dailyRemaining = Math.max(0, FREE_TIER_DAILY_LIMIT - dailyUsed);
    el.textContent = `Free suggestions remaining: ${Math.min(lifetimeRemaining, dailyRemaining)} today (${lifetimeRemaining} lifetime).`;
  } catch {
    el.textContent = "Free suggestions: quota unavailable.";
  }
}

async function renderUpdateNotice() {
  const noticeEl = document.querySelector("#updateNotice");
  if (!noticeEl) return;
  try {
    const got = await chrome.storage.local.get(UPDATE_NOTICE_KEY);
    const notice = got?.[UPDATE_NOTICE_KEY];
    if (!notice || notice.dismissed) {
      noticeEl.hidden = true;
      return;
    }

    const title = document.querySelector("#updateNoticeTitle");
    const message = document.querySelector("#updateNoticeMessage");
    const list = document.querySelector("#updateNoticeList");
    if (title) title.textContent = notice.title || "Ghostwriter updated";
    if (message) message.textContent = notice.message || "Your settings were preserved.";
    if (list) {
      list.innerHTML = "";
      const actions = Array.isArray(notice.actions) ? notice.actions : [];
      for (const item of actions) {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      }
      list.hidden = !actions.length;
    }
    noticeEl.hidden = false;
  } catch {
    noticeEl.hidden = true;
  }
}

async function dismissUpdateNotice() {
  try {
    const got = await chrome.storage.local.get(UPDATE_NOTICE_KEY);
    const notice = got?.[UPDATE_NOTICE_KEY];
    if (notice) {
      await chrome.storage.local.set({
        [UPDATE_NOTICE_KEY]: {
          ...notice,
          dismissed: true,
          dismissedAt: Date.now(),
        },
      });
    }
  } catch {}
  const noticeEl = document.querySelector("#updateNotice");
  if (noticeEl) noticeEl.hidden = true;
}

function applyOptionsViewMode(mode) {
  const html = document.documentElement;

  const effectiveMode = mode || "auto";
  const isNarrow = window.innerWidth <= 520;

  if (effectiveMode === "mobile" || (effectiveMode === "auto" && isNarrow)) {
    html.setAttribute("data-options-view", "mobile");
  } else {
    html.removeAttribute("data-options-view");
  }
}

function normalizeProvider(value) {
  if (value === "gemini") return "gemini";
  if (value === "openai") return "openai";
  if (value === "claude") return "claude";
  return "ultimate";
}

function inferProviderFromOptions(opts) {
  if (opts?.llmProvider) return normalizeProvider(opts.llmProvider);
  if (opts?.openaiKey) return "openai";
  if (opts?.ultimateKey) return "ultimate";
  if (opts?.geminiKey) return "gemini";
  if (opts?.claudeKey) return "claude";
  return "openai";
}

function normalizeEditorSurface(value) {
  if (value === "side_panel" || value === "sidePanel") return "side_panel";
  if (value === "tab") return "tab";
  return "overlay";
}

async function anki(action, params = {}) {
  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "quickflash:anki", action, params },
      (res) => resolve(res)
    );
  });

  if (response && response.ok) {
    return response.result;
  }

  const err = response?.error || "AnkiConnect request failed.";
  throw new Error(err);
}

// Read the per-provider config from stored options
function getProviderConfigFromOpts(opts, providerOverride) {
  const provider = providerOverride ? normalizeProvider(providerOverride) : inferProviderFromOptions(opts || {});
  const cfg = { provider, baseUrl: "", apiKey: "", model: "", streamFront: false };

  if (provider === "gemini") {
    cfg.baseUrl = opts.geminiBaseUrl || PROVIDER_DEFAULTS.gemini.baseUrl;
    cfg.apiKey = opts.geminiKey || "";
    cfg.model = opts.geminiModel || PROVIDER_DEFAULTS.gemini.model;
    cfg.streamFront = !!opts.geminiStreamFront;
  } else if (provider === "openai") {
    cfg.baseUrl = opts.openaiBaseUrl || PROVIDER_DEFAULTS.openai.baseUrl;
    cfg.apiKey = opts.openaiKey || "";
    // fallback to ultimateModel for older saves
    cfg.model = opts.openaiModel || opts.ultimateModel || PROVIDER_DEFAULTS.openai.model;
  } else if (provider === "claude") {
    cfg.baseUrl = opts.claudeBaseUrl || PROVIDER_DEFAULTS.claude.baseUrl;
    cfg.apiKey = opts.claudeKey || "";
    cfg.model = opts.claudeModel || PROVIDER_DEFAULTS.claude.model;
  } else {
    // UltimateAI (open-source / hosted)
    cfg.baseUrl = opts.ultimateBaseUrl || PROVIDER_DEFAULTS.ultimate.baseUrl;
    cfg.apiKey = opts.ultimateKey || "";
    cfg.model = opts.ultimateModel || PROVIDER_DEFAULTS.ultimate.model;
  }

  return cfg;
}

async function storePermissionJustifications() {
  try {
    const { quickflash_permission_justifications: stored } = await chrome.storage.local.get(
      "quickflash_permission_justifications"
    );
    const existing = stored && typeof stored === "object" ? stored : {};
    const next = {
      ...existing,
      clipboardRead: {
        ...PERMISSION_JUSTIFICATIONS.clipboardRead,
        updatedAt: new Date().toISOString(),
      },
    };
    await chrome.storage.local.set({ quickflash_permission_justifications: next });
  } catch {}
}

// Write the ACTIVE provider's config back into the data object
function writeProviderConfigToData(data, base, provider, ui) {
  const p = normalizeProvider(provider);
  const baseUrl = (ui.baseUrl || "").trim();
  const apiKey = (ui.apiKey || "").trim();
  const model = (ui.model || "").trim();
  const streamFront = !!ui.streamFront;

  if (p === "gemini") {
    data.geminiBaseUrl = baseUrl || base.geminiBaseUrl || PROVIDER_DEFAULTS.gemini.baseUrl;
    data.geminiKey = apiKey;
    data.geminiModel = model || base.geminiModel || PROVIDER_DEFAULTS.gemini.model;
    data.geminiStreamFront = streamFront;
  } else if (p === "openai") {
    data.openaiBaseUrl = baseUrl || base.openaiBaseUrl || PROVIDER_DEFAULTS.openai.baseUrl;
    data.openaiKey = apiKey;
    data.openaiModel = model || base.openaiModel || base.ultimateModel || PROVIDER_DEFAULTS.openai.model;
  } else if (p === "claude") {
    data.claudeBaseUrl = baseUrl || base.claudeBaseUrl || PROVIDER_DEFAULTS.claude.baseUrl;
    data.claudeKey = apiKey;
    data.claudeModel = model || base.claudeModel || PROVIDER_DEFAULTS.claude.model;
  } else {
    // ultimate
    data.ultimateBaseUrl = baseUrl || base.ultimateBaseUrl || PROVIDER_DEFAULTS.ultimate.baseUrl;
    data.ultimateKey = apiKey;
    data.ultimateModel = model || base.ultimateModel || PROVIDER_DEFAULTS.ultimate.model;
  }

  data.llmProvider = p;
}

// Toggle the “streaming warning” text when Gemini streaming is on
function updateGeminiStreamWarning() {
  const select = document.querySelector("#providerStreamFront");
  const warning = document.querySelector("#geminiStreamWarning");
  if (!select || !warning) return;
  warning.hidden = (select.value !== "true");
}

// Apply the current provider selection into the UI
function applyProviderChoiceUI(provider, optsOverride) {
  const opts = optsOverride || currentOptionsCache || {};
  const p = provider ? normalizeProvider(provider) : inferProviderFromOptions(opts);
  const cfg = getProviderConfigFromOpts(opts, p);

  const preset = document.querySelector("#providerPreset");
  if (preset) preset.value = p;

  const baseInput = document.querySelector("#providerBaseUrl");
  const keyInput = document.querySelector("#providerApiKey");
  const modelSelect = document.querySelector("#providerModelSelect");
  const modelCustom = document.querySelector("#providerModelCustom");
  const modelHelp = document.querySelector("#providerModelHelp");
  const streamField = document.querySelector("#providerStreamField");
  const streamSelect = document.querySelector("#providerStreamFront");

  if (baseInput) {
    baseInput.value = cfg.baseUrl;
    baseInput.placeholder = (PROVIDER_DEFAULTS[p] || PROVIDER_DEFAULTS.ultimate).baseUrl;
  }

  if (keyInput) {
    keyInput.value = cfg.apiKey;
    const fallback = PROVIDER_DEFAULTS.ultimate.keyPlaceholder;
    keyInput.placeholder = (PROVIDER_DEFAULTS[p] || {}).keyPlaceholder || fallback;
  }

  if (modelSelect) {
    const models = KNOWN_MODELS[p] || KNOWN_MODELS.ultimate;
    modelSelect.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      modelSelect.appendChild(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = "__custom__";
    customOpt.textContent = "Custom\u2026";
    modelSelect.appendChild(customOpt);

    const isKnown = models.some((m) => m.id === cfg.model);
    if (isKnown) {
      modelSelect.value = cfg.model;
      if (modelCustom) { modelCustom.hidden = true; modelCustom.value = ""; }
    } else {
      modelSelect.value = "__custom__";
      if (modelCustom) { modelCustom.hidden = false; modelCustom.value = cfg.model; }
    }
  }

  if (modelHelp) {
    if (p === "gemini") {
      modelHelp.textContent = "Used when Google Gemini is selected.";
    } else if (p === "openai") {
      modelHelp.textContent = "Used for direct OpenAI calls.";
    } else if (p === "claude") {
      modelHelp.textContent = "Used for Anthropic Claude API calls.";
    } else {
      modelHelp.textContent = "Used for UltimateAI calls. Auto is the recommended fast default; Custom accepts any UltimateAI model ID.";
    }
  }

  if (streamField) {
    const isGemini = p === "gemini";
    streamField.hidden = !isGemini; // hides the whole field in non-Gemini modes
    if (isGemini && streamSelect) {
      streamSelect.value = cfg.streamFront ? "true" : "false";
      updateGeminiStreamWarning();
    }
  }
}

function initGeminiStreamUI() {
  const select = document.querySelector("#providerStreamFront");
  if (!select) return;
  select.addEventListener("change", updateGeminiStreamWarning);
  updateGeminiStreamWarning();
}

function getDefaultCopilotPrompts() {
  const overrides = typeof window !== "undefined" ? window.QUICKFLASH_PROMPTS : null;
  const frontOverride = (overrides?.frontSystem || "").trim();
  const backOverride = (overrides?.backSystem || "").trim();
  const frontFromBackOverride = (overrides?.frontFromBackSystem || "").trim();
  return {
    front: frontOverride || DEFAULT_COPILOT_FRONT_PROMPT,
    back: backOverride || DEFAULT_COPILOT_BACK_PROMPT,
    frontFromBack: frontFromBackOverride || DEFAULT_COPILOT_FRONT_FROM_BACK_PROMPT,
  };
}

function buildSimpleTemplatePrompt(kind) {
  return `Return ONLY valid JSON. Never include explanations or backticks.
Target: ${kind}
Output shape:
{
  "cards": [
    { "type":"basic", "front":"...", "back":"...", "tags":["AI-generated"], "context":"${kind}" }
  ]
}
Rules:
- Keep answers atomic; fronts univocal.
- Prefer short, precise wording; include minimal necessary notation/units.
- STRICT MATH RULE: Do NOT use Unicode for mathematical symbols (e.g., do not use ⇒, α, ∫). ALWAYS use LaTeX formatting (e.g., \\Rightarrow, \\alpha, \\int). Output math wrapped in standard \\(...\\) or \\[...\\] delimiters.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildDefinitionTemplatePrompt() {
  return `Return ONLY valid JSON. Never include explanations or backticks.
Target: definition
Output shape:
{
  "cards": [
    { "type":"basic", "front":"Define <word> (<part of speech>)", "back":"<definition>", "tags":["AI-generated"], "context":"definition" },
    { "type":"basic", "front":"Definition: <definition>", "back":"<word>", "tags":["AI-generated"], "context":"definition" }
  ]
}
Rules:
- Card 1 front must be "Define <word> (<part of speech>)".
- Card 1 back is the definition (concise, atomic).
- Card 2 front must be "Definition: <definition>" and reuse the exact same definition text as Card 1 back.
- Card 2 back is the word.
- Use the best part of speech if known; otherwise use "term".
- Prefer short, precise wording; include minimal necessary notation/units.
- STRICT MATH RULE: Do NOT use Unicode for mathematical symbols (e.g., do not use ⇒, α, ∫). ALWAYS use LaTeX formatting (e.g., \\Rightarrow, \\alpha, \\int). Output math wrapped in standard \\(...\\) or \\[...\\] delimiters.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildResearchPaperTemplatePrompt() {
  return `Return ONLY valid JSON. Never include explanations or backticks.
You are making bibliography drill cards for a research paper.
Extract: paper_name, authors (comma-separated), year (YYYY), and journal (official name if present).
If journal is unknown, use an em dash "—" as the answer.

Output shape EXACTLY:
{
  "deck": "",  // optional
  "cards": [
    { "type":"basic", "front":"Paper Name: <paper_name> – (a,y)?", "back":"<authors> (<year>)", "tags":["AI-generated"], "context":"Bibliography — canonical" },
    { "type":"basic", "front":"<authors> (<year>) published in <journal> – paper name?", "back":"<paper_name>", "tags":["AI-generated"], "context":"Bibliography — recall" },
    { "type":"basic", "front":"\"<paper_name>\" – journal?", "back":"<journal>", "tags":["AI-generated"], "context":"Bibliography — journal" }
  ]
}
Rules:
- Keep "(a,y)?" exactly as written, do not replace it with author/year text.
- Preserve capitalization of the official paper and journal titles.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildLegacyResearchPaperTemplatePrompt() {
  return `Return ONLY valid JSON. Never include explanations or backticks.
You are making bibliography drill cards for a research paper.
Extract: paper_name, authors (comma-separated), year (YYYY), and journal (official name if present).

Output shape EXACTLY:
{
  "deck": "",  // optional
  "cards": [
    { "type":"basic", "front":"Paper Name: <paper_name> – (a,y)?", "back":"<authors> (<year>)", "tags":["AI-generated"], "context":"Bibliography — canonical" },
    { "type":"basic", "front":"<authors> (<year>) published in <journal> – paper name?", "back":"<paper_name>", "tags":["AI-generated"], "context":"Bibliography — recall" },
    { "type":"basic", "front":"\"<paper_name>\" – journal?", "back":"<journal>", "tags":["AI-generated"], "context":"Bibliography — journal" }
  ]
}
Rules:
- Keep "(a,y)?" exactly as written, do not replace it with author/year text.
- Preserve capitalization of the official paper and journal titles.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function upgradeDefinitionPromptIfNeeded(templates) {
  const oldPrompt = buildSimpleTemplatePrompt("definition").trim();
  const newPrompt = buildDefinitionTemplatePrompt();
  let changed = false;
  const updated = (templates || []).map((tpl) => {
    if (tpl?.id === "definition" && typeof tpl.prompt === "string" && tpl.prompt.trim() === oldPrompt) {
      changed = true;
      return { ...tpl, prompt: newPrompt };
    }
    return tpl;
  });
  return { updated, changed };
}

function upgradeResearchPaperPromptIfNeeded(templates) {
  const oldPrompt = buildLegacyResearchPaperTemplatePrompt().trim();
  const newPrompt = buildResearchPaperTemplatePrompt();
  let changed = false;
  const updated = (templates || []).map((tpl) => {
    if (tpl?.id === "research-paper" && typeof tpl.prompt === "string" && tpl.prompt.trim() === oldPrompt) {
      changed = true;
      return { ...tpl, prompt: newPrompt };
    }
    return tpl;
  });
  return { updated, changed };
}

function buildFocusedSuggestionModePrompt(mode) {
  const baseRules = `Rules:
- Preserve the user's apparent target from Front/Back/Notes before using the Source.
- Do not decide what is "important" on the user's behalf; the highlight and typed words are the signal.
- Make one stable retrieval cue: enough context to cue the same answer months later, but no answer leakage.
- Cue, don't disclose: the Front names the problem/context, while the Back holds the method, formula, definition, result, name, or example.
- If a Front would need "by defining", "using", "where", "namely", or another answer-bearing phrase, stop before that phrase.
- Avoid T1-style failures: vague context, multiple valid answers, shallow textbook lists, and passage restatement.
- Stay grounded in the Source. If the target is unclear or unsupported, return an empty string for uncertain fields.
- No preamble, markdown, critique, or alternatives.
{{CONTEXT}}

Current card:
Front: {{FRONT}}
Back: {{BACK}}
Notes: {{NOTES}}

Source:
{{TEXT}}`;

  switch (mode) {
    case "complete-front":
      return `Return ONLY valid JSON: { "front": "..." }
Complete the user's Front for this single card. Continue their wording when possible.
${baseRules}`;
    case "complete-back":
      return `Return ONLY valid JSON: { "back": "..." }
Complete the Back for this single card. Answer the Front exactly, with the smallest stable answer.
${baseRules}`;
    case "rewrite-front":
      return `Return ONLY valid JSON: { "front": "..." }
Rewrite the Front only enough to make the user's intended target stable and answerable.
${baseRules}`;
    case "make-atomic":
      return `Return ONLY valid JSON: { "front": "...", "back": "..." }
Repair this as one atomic Anki card. Preserve the user's intended target even if another source fact is easier.
${baseRules}`;
    case "generate-candidate":
    default:
      return `Return ONLY valid JSON. Never include explanations or backticks.
Create exactly ONE candidate Anki card only if the Source/highlight implies a specific memorable target.
Output shape:
{ "cards": [ { "type":"basic", "front":"...", "back":"...", "tags":["AI-suggested"], "context":"source-grounded" } ] }
Rules:
- Exactly one card.
- One target only: preserve what made the highlight worth marking, not generic trivia nearby.
- Front is an unambiguous cue that will still work months later.
- Front must cue the missing answer without disclosing the method/formula/definition/result/name/example.
- Back is the minimal answer that satisfies the cue.
- Prefer sentence-completion cues when they preserve the highlighted novelty better than generic questions.
- Use the Source only. If no good single card can be made, return { "cards": [] }.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
  }
}

const DEFAULT_TEMPLATES = [
  {
    id: "complete-front",
    name: "Complete Front",
    prompt: buildFocusedSuggestionModePrompt("complete-front")
  },
  {
    id: "complete-back",
    name: "Complete Back",
    prompt: buildFocusedSuggestionModePrompt("complete-back")
  },
  {
    id: "rewrite-front",
    name: "Rewrite Front",
    prompt: buildFocusedSuggestionModePrompt("rewrite-front")
  },
  {
    id: "make-atomic",
    name: "Make Atomic",
    prompt: buildFocusedSuggestionModePrompt("make-atomic")
  },
  {
    id: "generate-candidate",
    name: "Generate Candidate From Source",
    prompt: buildFocusedSuggestionModePrompt("generate-candidate")
  }
];

const TEMPLATE_UPDATE_MODES = {
  keep: "keep",
  apply: "apply",
};
const DEFAULT_TEMPLATE_UPDATE_MODE = TEMPLATE_UPDATE_MODES.keep;

let templateState = [];
let templateEditingId = null;
let templateMsgTimer = null;
const num = (sel, dflt) => {
  const n = parseInt($(sel).value, 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

function parseShortcut(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.split(/[\s+]+/).filter(Boolean);
  if (!parts.length) return null;
  const state = { key: null, ctrl: false, alt: false, shift: false, meta: false };
  for (const raw of parts) {
    const token = raw.toLowerCase();
    if (["ctrl", "control"].includes(token)) state.ctrl = true;
    else if (["alt", "option"].includes(token)) state.alt = true;
    else if (["shift"].includes(token)) state.shift = true;
    else if (["cmd", "command", "meta", "⌘"].includes(token)) state.meta = true;
    else if (!state.key) {
      state.key = token.length === 1 ? token : token;
    } else {
      return null;
    }
  }
  if (!state.key) return null;
  return state;
}

function applyEditorFieldLabelsFromConfig(opts) {
  try {
    const cfg = opts && typeof opts.editorFieldConfig === "object"
      ? opts.editorFieldConfig
      : null;
    if (!cfg) return;

    const getLabel = (key, fallback) => {
      const entry = cfg[key];
      const raw = entry && typeof entry.label === "string" ? entry.label.trim() : "";
      return raw || fallback;
    };

    const notesLabel = getLabel("extra", "Notes");
    const contextLabel = getLabel("context", "Context");
    const sourceLabel = getLabel("source_excerpt", "Source");

    const notesSpan = $("#showNotesFieldLabel");
    if (notesSpan) notesSpan.textContent = `Show “${notesLabel}” field`;
    const ctxSpan = $("#showContextFieldLabel");
    if (ctxSpan) ctxSpan.textContent = `Show “${contextLabel}” field`;
    const srcSpan = $("#showSourceFieldLabel");
    if (srcSpan) srcSpan.textContent = `Show “${sourceLabel}” field`;
  } catch (err) {
    console.warn("Failed to apply editor field labels from config", err);
  }
}

function serializeShortcut(shortcut) {
  if (!shortcut || !shortcut.key) return "";
  const parts = [];
  if (shortcut.ctrl) parts.push("Ctrl");
  if (shortcut.meta) parts.push("Cmd");
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return parts.join("+");
}

function normalizeShortcutInput(raw) {
  const parsed = parseShortcut(raw);
  if (!parsed) return null;
  return parsed;
}

function normalizeStoredQueueShortcut(value) {
  const stored = parseShortcut(value);
  const isLegacyDefault = stored?.meta && stored?.shift && !stored?.ctrl && !stored?.alt && stored?.key === "q";
  return isLegacyDefault ? DEFAULT_SHORTCUT : value;
}

function normalizeEditorFieldConfig(cfg) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
  const normalized = {};
  Object.keys(cfg).sort().forEach((key) => {
    const val = cfg[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const inner = {};
      Object.keys(val).sort().forEach((innerKey) => {
        inner[innerKey] = val[innerKey];
      });
      normalized[key] = inner;
    } else {
      normalized[key] = val;
    }
  });
  return normalized;
}

function isDefaultEditorFieldConfig(cfg) {
  const normalized = normalizeEditorFieldConfig(cfg);
  const defaultNormalized = normalizeEditorFieldConfig(DEFAULT_EDITOR_FIELD_CONFIG);
  if (!normalized || !defaultNormalized) return false;
  return JSON.stringify(normalized) === JSON.stringify(defaultNormalized);
}

async function save() {
  const shortcutInput = $("#addShortcut").value.trim();
  let shortcut = null;
  if (shortcutInput) shortcut = normalizeShortcutInput(shortcutInput);
  if (!shortcut && shortcutInput) {
    $("#msg").textContent = "Invalid shortcut, using default.";
    $("#msg").className = "err";
    shortcut = parseShortcut(DEFAULT_SHORTCUT);
  }
  const shortcutValue = shortcut ? serializeShortcut(shortcut) : "";

  const D = window.GHOSTWRITER_DEFAULTS || {};
  const timeoutSec = num("#copilotTimeoutSec", Math.round((D.copilotTimeoutMs || 30000) / 1000));

  const { [OPTIONS_KEY]: existing } = await chrome.storage.sync.get(OPTIONS_KEY);
  const base = existing || {};

  const provider = normalizeProvider(
    document.querySelector("#providerPreset")?.value || base.llmProvider || "openai"
  );

  const providerBaseUrl = document.querySelector("#providerBaseUrl")?.value.trim() || "";
  const providerApiKey  = document.querySelector("#providerApiKey")?.value.trim() || "";
  const modelSelectVal = document.querySelector("#providerModelSelect")?.value || "";
  const modelCustomVal = document.querySelector("#providerModelCustom")?.value.trim() || "";
  const providerModel = modelSelectVal === "__custom__" ? modelCustomVal : modelSelectVal;
  const providerStreamFront = document.querySelector("#providerStreamFront")?.value === "true";

  // Parse custom editor field config (optional)
  let editorFieldConfig = base.editorFieldConfig || null;
  const cfgEl = document.getElementById("editorFieldConfig");
  if (cfgEl) {
    const raw = cfgEl.value.trim();
    if (!raw) {
      editorFieldConfig = null;
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("must be an object mapping field ids to configs");
        }
        editorFieldConfig = isDefaultEditorFieldConfig(parsed) ? null : parsed;
      } catch (err) {
        console.warn("Invalid editorFieldConfig JSON, keeping previous value:", err);
        alert("Custom editor field config JSON is invalid; keeping the previous value.\n\n" + err.message);
      }
    }
  }

  const data = {
    ...base,
    autoTagAI: $("#manualAutoTag").value === "true",
    autoCompleteAI: $("#autoCompleteAI").value === "true",
    autoMagicGenerate: $("#autoMagicGenerate").checked,
    manualCopilotOnly: $("#manualCopilotOnly").checked,
    copilotShortcut: $("#copilotShortcut").value.trim() || DEFAULT_COPILOT_SHORTCUT,
    copilotFrontSystemPrompt: $("#copilotFrontSystemPrompt")?.value.trim() || DEFAULT_COPILOT_FRONT_PROMPT,
    copilotBackSystemPrompt: $("#copilotBackSystemPrompt")?.value.trim() || DEFAULT_COPILOT_BACK_PROMPT,
    copilotFrontFromBackSystemPrompt: $("#copilotFrontFromBackSystemPrompt")?.value.trim() || DEFAULT_COPILOT_FRONT_FROM_BACK_PROMPT,
    autoFillBackAI: $("#copilotAutoFillBack").checked,
    copilotFrontWordCap: num("#copilotFrontWordCap", D.copilotFrontWordCap || 24),
    copilotBackWordCap: num("#copilotBackWordCap", D.copilotBackWordCap || 18),
    copilotFrontMaxTokens: num("#copilotFrontMaxTokens", D.copilotFrontMaxTokens || 48),
    copilotBackMaxTokens: num("#copilotBackMaxTokens", D.copilotBackMaxTokens || 36),
    copilotMinIntervalMs: num("#copilotMinIntervalMs", D.copilotMinIntervalMs || 1200),
    copilotTimeoutMs: Math.max(1000, timeoutSec * 1000),
    showMiniCopilotMode: ($("#showMiniCopilotMode").value || "off"),
    showSourceModePill: !!$("#showSourceModePill")?.checked,
    showShortcutHints: document.querySelector("#showShortcutHints")?.checked !== false,
    editorViewMode: document.querySelector("#editorViewMode")?.value || base.editorViewMode || "auto",
    defaultEditorSurface: normalizeEditorSurface(document.querySelector("#defaultEditorSurface")?.value || base.defaultEditorSurface),
    closeOverlayAfterQueue: !!document.querySelector("#closeOverlayAfterQueue")?.checked,
    // Persist any custom per-field editor configuration alongside other editor settings
    editorFieldConfig,

    // Anki defaults
    defaultDeck: $("#defaultDeck").value.trim() || "All Decks",

    ankiBaseUrl: $("#ankiBaseUrl").value.trim() || "http://127.0.0.1:8765",

    appendQuickflashTag: $("#appendQuickflashTag").checked,
    quickflashTagName: ($("#quickflashTagName").value.trim() || "ghostwriter"),

    // Manual helpers
    manualAutoTag: $("#manualAutoTag").value === "true",
    manualAutoContext: $("#manualAutoContext").value === "true",
    manualAutoPreview: $("#manualAutoPreview").value === "true",
    showNotesField: $("#showNotesField").checked,
    showContextField: $("#showContextField").checked,
    showSourceField: $("#showSourceField").checked,
    appendContextToFrontWhenMissing: $("#appendContextToFrontWhenMissing").checked,
    clipboardFallback: $("#clipboardFallback").checked,
    debugMode: $("#debugMode").checked,
    addShortcut: shortcutValue,
    templateUpdateMode:
      document.querySelector("#templateUpdateMode")?.value || base.templateUpdateMode || DEFAULT_TEMPLATE_UPDATE_MODE,
  };

  writeProviderConfigToData(data, base, provider, {
    baseUrl: providerBaseUrl,
    apiKey: providerApiKey,
    model: providerModel,
    streamFront: providerStreamFront,
  });

  // Manual helpers (unchanged)
  data.manualAutoTag = document.querySelector("#manualAutoTag").value === "true";
  data.manualAutoContext = document.querySelector("#manualAutoContext").value === "true";
  data.manualAutoPreview = document.querySelector("#manualAutoPreview").value === "true";

  currentOptionsCache = data;
  await chrome.storage.sync.set({ [OPTIONS_KEY]: data });
  if (data.showShortcutHints !== false) {
    try {
      const got = await chrome.storage.local.get(SHORTCUT_COACH_KEY);
      const state = got?.[SHORTCUT_COACH_KEY];
      if (state?.hintsDismissed) {
        await chrome.storage.local.set({
          [SHORTCUT_COACH_KEY]: {
            ...state,
            hintsDismissed: false,
            reenabledAt: Date.now(),
          },
        });
      }
    } catch {}
  }
  if (!shortcutInput || shortcut) {
    $("#msg").textContent = "Saved.";
    $("#msg").className = "ok";
  }
  setTimeout(() => { $("#msg").textContent=""; $("#msg").className=""; }, 1600);
  if (shortcut) $("#addShortcut").value = serializeShortcut(shortcut);
}

async function load() {
  const { [OPTIONS_KEY]: quickflash_options } = await chrome.storage.sync.get(OPTIONS_KEY);
  const opts = quickflash_options || {};
  currentOptionsCache = opts;
  await renderFreeTierStatus();

  // Infer provider for older saves; focused v2 defaults to OpenAI/free-tier proxy.
  const provider = inferProviderFromOptions(opts);

  // AI provider connection UI (base URL, key, model, stream)
  applyProviderChoiceUI(provider, opts);

  // --- rest of your load() is unchanged: Copilot, defaults, etc. ---
  document.querySelector("#autoCompleteAI").value = String(opts.autoCompleteAI !== false);
  document.querySelector("#autoMagicGenerate").checked = !!opts.autoMagicGenerate;
  document.querySelector("#manualCopilotOnly").checked = opts.manualCopilotOnly !== false;
  document.querySelector("#copilotShortcut").value = opts.copilotShortcut || DEFAULT_COPILOT_SHORTCUT;
  const defaults = getDefaultCopilotPrompts();
  const frontPrompt = defaults.front;
  const backPrompt = defaults.back;
  const frontFromBackPrompt = defaults.frontFromBack;
  document.querySelector("#copilotFrontSystemPrompt").value = frontPrompt;
  document.querySelector("#copilotBackSystemPrompt").value = backPrompt;
  document.querySelector("#copilotFrontFromBackSystemPrompt").value = frontFromBackPrompt;
  document.querySelector("#copilotAutoFillBack").checked = opts.autoFillBackAI !== false;
  const D = window.GHOSTWRITER_DEFAULTS || {};
  document.querySelector("#copilotFrontWordCap").value = String(opts.copilotFrontWordCap ?? D.copilotFrontWordCap ?? 24);
  document.querySelector("#copilotBackWordCap").value = String(opts.copilotBackWordCap ?? D.copilotBackWordCap ?? 18);
  document.querySelector("#copilotFrontMaxTokens").value = String(opts.copilotFrontMaxTokens ?? D.copilotFrontMaxTokens ?? 48);
  document.querySelector("#copilotBackMaxTokens").value = String(opts.copilotBackMaxTokens ?? D.copilotBackMaxTokens ?? 36);
  document.querySelector("#copilotMinIntervalMs").value = String(opts.copilotMinIntervalMs ?? D.copilotMinIntervalMs ?? 1200);
  document.querySelector("#copilotTimeoutSec").value = String(Math.round((opts.copilotTimeoutMs ?? D.copilotTimeoutMs ?? 30000) / 1000));
  document.querySelector("#showMiniCopilotMode").value = opts.showMiniCopilotMode ?? D.showMiniCopilotMode ?? "off";
  const pill = document.querySelector("#showSourceModePill");
  if (pill) pill.checked = opts.showSourceModePill !== false;
  const shortcutHints = document.querySelector("#showShortcutHints");
  if (shortcutHints) shortcutHints.checked = opts.showShortcutHints ?? D.showShortcutHints ?? true;
  const viewSelect = document.querySelector("#editorViewMode");
  if (viewSelect) {
    viewSelect.value = opts.editorViewMode || "auto";
    applyOptionsViewMode(viewSelect.value);
    viewSelect.addEventListener("change", () => {
      applyOptionsViewMode(viewSelect.value);
    });
  }
  const surfaceSelect = document.querySelector("#defaultEditorSurface");
  if (surfaceSelect) surfaceSelect.value = normalizeEditorSurface(opts.defaultEditorSurface);

  // Defaults / Anki
  document.querySelector("#defaultDeck").value  = opts.defaultDeck || "All Decks";
  document.querySelector("#ankiBaseUrl").value  = opts.ankiBaseUrl || "http://127.0.0.1:8765";

  document.querySelector("#appendQuickflashTag").checked = opts.appendQuickflashTag !== false;
  document.querySelector("#quickflashTagName").value = opts.quickflashTagName || "ghostwriter";

  const toggle = document.querySelector("#appendQuickflashTag");
  const tagRow = document.querySelector("#quickflashTagNameRow");
  if (toggle && tagRow) tagRow.style.display = toggle.checked ? "inline-flex" : "none";
  if (toggle) {
    toggle.addEventListener("change", () => {
      if (tagRow) tagRow.style.display = toggle.checked ? "inline-flex" : "none";
    });
  }

  const extOrigin = `chrome-extension://${chrome.runtime.id}`;
  const extOriginInput = document.querySelector("#extOrigin");
  if (extOriginInput) extOriginInput.value = extOrigin;

  // Manual helpers
  document.querySelector("#manualAutoTag").value = String(opts.manualAutoTag ?? true);
  document.querySelector("#manualAutoContext").value = String(opts.manualAutoContext ?? true);
  document.querySelector("#manualAutoPreview").value = String(opts.manualAutoPreview ?? false);
  document.querySelector("#showNotesField").checked = !!opts.showNotesField;
  document.querySelector("#showContextField").checked = opts.showContextField !== false;
  document.querySelector("#showSourceField").checked = opts.showSourceField !== false;
  const debugModeCheckbox = document.querySelector("#debugMode");
  if (debugModeCheckbox) debugModeCheckbox.checked = !!opts.debugMode;
  const appendContextCheckbox = document.querySelector("#appendContextToFrontWhenMissing");
  if (appendContextCheckbox) appendContextCheckbox.checked = !!opts.appendContextToFrontWhenMissing;
  const closeOverlayAfterQueueCheckbox = document.querySelector("#closeOverlayAfterQueue");
  if (closeOverlayAfterQueueCheckbox) {
    closeOverlayAfterQueueCheckbox.checked = !!(opts.closeOverlayAfterQueue ?? D.closeOverlayAfterQueue ?? false);
  }

  const templateUpdateSelect = document.querySelector("#templateUpdateMode");
  if (templateUpdateSelect) {
    templateUpdateSelect.value = getTemplateUpdateMode(opts);
  }

  const inferredFallback =
    (typeof opts.clipboardFallback === "boolean")
      ? opts.clipboardFallback
      : !!(opts.clipboardAsSourceIfNoSelection ?? opts.pasteClipboardIfNoSelection ?? true);
  document.querySelector("#clipboardFallback").checked = inferredFallback;

  // Custom editor field config + shortcut handling as you already had
  const cfgEl = document.getElementById("editorFieldConfig");
  if (cfgEl) {
    const cfg = opts.editorFieldConfig;
    if (cfg && typeof cfg === "object") {
      try {
        cfgEl.value = JSON.stringify(cfg, null, 2);
      } catch {
        // Fallback: leave whatever is there
      }
    } else {
      cfgEl.value = JSON.stringify(DEFAULT_EDITOR_FIELD_CONFIG, null, 2);
    }
  }

  const effectiveEditorConfig = opts.editorFieldConfig || DEFAULT_EDITOR_FIELD_CONFIG;
  applyEditorFieldLabelsFromConfig({ ...opts, editorFieldConfig: effectiveEditorConfig });

  const rawShortcut = normalizeStoredQueueShortcut(
    typeof opts.addShortcut === "string" ? opts.addShortcut : DEFAULT_SHORTCUT
  );
  const parsedShortcut = parseShortcut(rawShortcut);
  document.querySelector("#addShortcut").value = rawShortcut === "" ? "" : (parsedShortcut ? serializeShortcut(parsedShortcut) : "");
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
}

function cloneTemplateEntry(entry) {
  const id = entry?.id ? String(entry.id) : `template-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return {
    id,
    name: entry?.name ? String(entry.name) : id,
    prompt: entry?.prompt ? String(entry.prompt) : "",
    isCustom: typeof entry?.isCustom === "boolean" ? entry.isCustom : false,
  };
}

function cloneDefaultTemplates() {
  return DEFAULT_TEMPLATES.map((tpl) => ({
    id: String(tpl.id),
    name: String(tpl.name),
    prompt: String(tpl.prompt),
    isCustom: false,
  }));
}

function getTemplateUpdateMode(opts) {
  if (opts?.templateUpdateMode === TEMPLATE_UPDATE_MODES.apply) return TEMPLATE_UPDATE_MODES.apply;
  return DEFAULT_TEMPLATE_UPDATE_MODE;
}

function normalizeStoredTemplate(entry, defaultsById) {
  const id = entry?.id ? String(entry.id) : `template-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const name = entry?.name ? String(entry.name) : id;
  const prompt = entry?.prompt ? String(entry.prompt) : "";
  const defaultTpl = defaultsById.get(id);
  const inferredCustom = !defaultTpl || defaultTpl.name !== name || defaultTpl.prompt !== prompt;
  const isCustom = typeof entry?.isCustom === "boolean" ? entry.isCustom : inferredCustom;
  return { id, name, prompt, isCustom };
}

function templatesMatch(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.id !== right.id) return false;
    if (left.name !== right.name) return false;
    if (left.prompt !== right.prompt) return false;
    if (!!left.isCustom !== !!right.isCustom) return false;
  }
  return true;
}

function reconcileTemplatesWithDefaults(stored, applyUpdates) {
  const defaults = cloneDefaultTemplates();
  const defaultsById = new Map(defaults.map((tpl) => [tpl.id, tpl]));
  const raw = Array.isArray(stored) ? stored : [];
  const filtered = raw.filter((tpl) => tpl && typeof tpl.prompt === "string");
  const normalized = filtered.map((tpl) => normalizeStoredTemplate(tpl, defaultsById));
  const missingCustomFlag = filtered.some((tpl) => typeof tpl?.isCustom !== "boolean");

  if (!normalized.length) {
    return { templates: defaults, changed: true };
  }

  if (!applyUpdates) {
    const changed = missingCustomFlag || raw.length !== normalized.length;
    return { templates: normalized, changed };
  }

  const byId = new Map(normalized.map((tpl) => [tpl.id, tpl]));
  const next = [];
  for (const def of defaults) {
    const existing = byId.get(def.id);
    if (existing) {
      next.push(existing.isCustom ? existing : { ...def, isCustom: false });
    } else {
      next.push({ ...def, isCustom: false });
    }
  }
  for (const tpl of normalized) {
    if (!defaultsById.has(tpl.id)) {
      next.push(tpl);
    }
  }
  const changed = !templatesMatch(next, normalized) || missingCustomFlag || raw.length !== normalized.length;
  return { templates: next, changed };
}

async function initTemplateManager() {
  const listEl = $("#templateList");
  if (!listEl) return;
  try {
    const { [OPTIONS_KEY]: storedOptions } = await chrome.storage.sync.get(OPTIONS_KEY);
    const updateMode = getTemplateUpdateMode(storedOptions);
    const data = await chrome.storage.sync.get("quickflash_templates");
    const stored = Array.isArray(data?.quickflash_templates) ? data.quickflash_templates : [];
    const { templates, changed } = reconcileTemplatesWithDefaults(
      stored,
      updateMode === TEMPLATE_UPDATE_MODES.apply
    );
    templateState = templates;
    if (changed) {
      await chrome.storage.sync.set({ quickflash_templates: templates });
    }
  } catch {
    templateState = cloneDefaultTemplates();
  }
  renderTemplateList();
}

function renderTemplateList() {
  const listEl = $("#templateList");
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!templateState.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "No suggestion modes configured.";
    listEl.appendChild(empty);
    return;
  }
  for (const tpl of templateState) {
    const row = document.createElement("div");
    row.className = "template-row";
    const meta = document.createElement("div");
    meta.innerHTML = `<strong>${escapeHtml(tpl.name || tpl.id)}</strong><div class="small">ID: ${escapeHtml(tpl.id)}</div>`;
    const actions = document.createElement("div");
    actions.className = "template-row-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.dataset.action = "edit";
    editBtn.dataset.id = tpl.id;
    editBtn.textContent = "Edit";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.dataset.action = "delete";
    delBtn.dataset.id = tpl.id;
    delBtn.textContent = "Delete";
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(meta);
    row.appendChild(actions);
    listEl.appendChild(row);
  }
}

function setTemplateMsg(text, className = "") {
  const msgEl = $("#templateMsg");
  if (!msgEl) return;
  msgEl.textContent = text || "";
  msgEl.className = ["small", "status", className].filter(Boolean).join(" ");
  if (templateMsgTimer) clearTimeout(templateMsgTimer);
  if (text) {
    templateMsgTimer = setTimeout(() => {
      msgEl.textContent = "";
      msgEl.className = "small status";
    }, 2000);
  }
}

function slugifyTemplateName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "template";
}

function ensureUniqueTemplateId(baseId) {
  const existing = new Set(templateState.map((tpl) => tpl.id));
  if (!existing.has(baseId)) return baseId;
  let i = 2;
  let id = `${baseId}-${i}`;
  while (existing.has(id)) {
    i += 1;
    id = `${baseId}-${i}`;
  }
  return id;
}

function clearTemplateForm() {
  templateEditingId = null;
  const idInput = $("#templateEditingId");
  if (idInput) idInput.value = "";
  $("#templateName").value = "";
  $("#templatePrompt").value = "";
  const saveBtn = $("#templateSave");
  if (saveBtn) saveBtn.textContent = "Save mode";
}

function startEditTemplate(id) {
  const tpl = templateState.find((item) => item.id === id);
  if (!tpl) return;
  templateEditingId = id;
  const idInput = $("#templateEditingId");
  if (idInput) idInput.value = id;
  $("#templateName").value = tpl.name || "";
  $("#templatePrompt").value = tpl.prompt || "";
  const saveBtn = $("#templateSave");
  if (saveBtn) saveBtn.textContent = "Update mode";
  setTemplateMsg(`Editing "${tpl.name || tpl.id}"`, "ok");
}

async function saveTemplatesToStorage() {
  const payload = templateState.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    prompt: tpl.prompt,
    isCustom: !!tpl.isCustom,
  }));
  await chrome.storage.sync.set({ quickflash_templates: payload });
}

async function handleTemplateSubmit() {
  const name = $("#templateName").value.trim();
  const prompt = $("#templatePrompt").value.trim();
  if (!name || !prompt) {
    setTemplateMsg("Name and prompt are required.", "err");
    return;
  }
  if (templateEditingId) {
    const idx = templateState.findIndex((tpl) => tpl.id === templateEditingId);
    if (idx !== -1) {
      templateState[idx] = { ...templateState[idx], name, prompt, isCustom: true };
      await saveTemplatesToStorage();
      setTemplateMsg("Template updated.", "ok");
      renderTemplateList();
      clearTemplateForm();
    }
    return;
  }
  const baseId = slugifyTemplateName(name);
  const id = ensureUniqueTemplateId(baseId);
  templateState.push({ id, name, prompt, isCustom: true });
  await saveTemplatesToStorage();
  setTemplateMsg("Template added.", "ok");
  renderTemplateList();
  clearTemplateForm();
}

async function deleteTemplate(id) {
  const idx = templateState.findIndex((tpl) => tpl.id === id);
  if (idx === -1) return;
  templateState.splice(idx, 1);
  if (templateEditingId === id) clearTemplateForm();
  await saveTemplatesToStorage();
  renderTemplateList();
  setTemplateMsg("Template deleted.", "ok");
}

async function handleTemplateReset() {
  const confirmed = confirm("Are you SURE you want to reset to defaults? Doing so will erase all custom prompts.");
  if (!confirmed) {
    setTemplateMsg("Reset canceled.", "");
    return;
  }
  templateState = cloneDefaultTemplates();
  clearTemplateForm();
  await saveTemplatesToStorage();
  renderTemplateList();
  setTemplateMsg("Templates reset to defaults.", "ok");
}

function handleTemplateListClick(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (!id) return;
  if (btn.dataset.action === "edit") {
    startEditTemplate(id);
  } else if (btn.dataset.action === "delete") {
    deleteTemplate(id).catch(() => setTemplateMsg("Could not delete mode.", "err"));
  }
}

async function test() {
  const msg = $("#testMsg");
  msg.textContent = "Testing…";
  msg.className = "";

  try {
    // Reuse the same routing logic as the main panel / background, so this
    // works both on desktop and on mobile (Edge/Android, alt hosts, etc.).
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "quickflash:anki", action: "version", params: {} },
        (res) => resolve(res)
      );
    });

    if (response && response.ok && response.result != null) {
      msg.textContent = `AnkiConnect OK (version ${response.result})`;
      msg.className = "ok";
      return;
    }

    const errText =
      (response && response.error) ||
      "Could not reach AnkiConnect. Is Anki running and AnkiConnect installed?";
    msg.textContent = errText;
    msg.className = "err";
  } catch (e) {
    msg.textContent = `Error: ${e.message}`;
    msg.className = "err";
  }
}

async function resetShortcutTips() {
  const msg = $("#tipsResetMsg");
  if (msg) {
    msg.textContent = "Resetting…";
    msg.className = "status";
  }

  try {
    const { [OPTIONS_KEY]: existing } = await chrome.storage.sync.get(OPTIONS_KEY);
    const next = {
      ...(existing || {}),
      showShortcutHints: true,
    };
    await chrome.storage.sync.set({ [OPTIONS_KEY]: next });
    await chrome.storage.local.remove(SHORTCUT_COACH_KEY);
    currentOptionsCache = next;
    const checkbox = $("#showShortcutHints");
    if (checkbox) checkbox.checked = true;
    if (msg) {
      msg.textContent = "Tips will show again in the editor.";
      msg.className = "ok";
    }
  } catch (err) {
    if (msg) {
      msg.textContent = `Could not reset tips: ${err?.message || err}`;
      msg.className = "err";
    }
  }

  setTimeout(() => {
    if (msg) {
      msg.textContent = "";
      msg.className = "status";
    }
  }, 1800);
}

window.addEventListener("resize", () => {
  const editorViewModeSelect = document.getElementById("editorViewMode");
  if (!editorViewModeSelect) return;
  if (editorViewModeSelect.value === "auto") {
    applyOptionsViewMode("auto");
  }
});

function initOptionsNavigation() {
  const panes = Array.from(document.querySelectorAll("[data-options-pane]"));
  const links = Array.from(document.querySelectorAll("[data-options-nav]"));
  if (!panes.length || !links.length) return;

  const ids = new Set(panes.map((pane) => pane.id));
  const showPane = (id, { updateHash = false } = {}) => {
    const targetId = ids.has(id) ? id : "connection";
    panes.forEach((pane) => {
      const active = pane.id === targetId;
      pane.hidden = !active;
      if (active) {
        const topDetails = pane.querySelector(":scope > details");
        if (topDetails) topDetails.open = true;
      }
    });
    links.forEach((link) => {
      const active = link.dataset.optionsNav === targetId;
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    if (updateHash && window.location.hash !== `#${targetId}`) {
      window.history.replaceState(null, "", `#${targetId}`);
    }
  };

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPane(link.dataset.optionsNav, { updateHash: true });
    });
  });

  document.querySelectorAll(".section-accordion > summary").forEach((summary) => {
    summary.addEventListener("click", (event) => {
      event.preventDefault();
    });
  });

  const initial = window.location.hash ? window.location.hash.slice(1) : "connection";
  showPane(initial);
}

document.addEventListener("DOMContentLoaded", () => {
  initOptionsNavigation();
  renderUpdateNotice();
  const dismissNotice = document.querySelector("#dismissUpdateNotice");
  if (dismissNotice) dismissNotice.addEventListener("click", (e) => {
    e.preventDefault();
    dismissUpdateNotice();
  });
  $("#save").addEventListener("click", save);
  $("#test").addEventListener("click", test);
  const resetTips = $("#resetShortcutTips");
  if (resetTips) {
    resetTips.addEventListener("click", (e) => {
      e.preventDefault();
      resetShortcutTips();
    });
  }
  const templateSave = $("#templateSave");
  if (templateSave) templateSave.addEventListener("click", (e) => {
    e.preventDefault();
    handleTemplateSubmit().catch(() => setTemplateMsg("Could not save mode.", "err"));
  });
  const templateClear = $("#templateClear");
  if (templateClear) templateClear.addEventListener("click", (e) => { e.preventDefault(); clearTemplateForm(); });
  const templateReset = $("#templateReset");
  if (templateReset) templateReset.addEventListener("click", (e) => {
    e.preventDefault();
    handleTemplateReset().catch(() => setTemplateMsg("Could not reset modes.", "err"));
  });
  const templateList = $("#templateList");
  if (templateList) templateList.addEventListener("click", handleTemplateListClick);
  load();
  storePermissionJustifications();
  initTemplateManager();
  initGeminiStreamUI();

  const providerSelect = document.querySelector("#providerPreset");
  if (providerSelect) {
    providerSelect.addEventListener("change", () => {
      applyProviderChoiceUI(providerSelect.value);
    });
  }

  const modelSelect = document.querySelector("#providerModelSelect");
  const modelCustom = document.querySelector("#providerModelCustom");
  if (modelSelect && modelCustom) {
    modelSelect.addEventListener("change", () => {
      if (modelSelect.value === "__custom__") {
        modelCustom.hidden = false;
        modelCustom.focus();
      } else {
        modelCustom.hidden = true;
        modelCustom.value = "";
      }
    });
  }
});

$("#copyExtOrigin").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#extOrigin").value);
    $("#msg").textContent = "Extension origin copied.";
    $("#msg").className = "ok";
  } catch {
    $("#msg").textContent = "Could not copy. Long‑press to select.";
    $("#msg").className = "err";
  }
});

(function () {
  const THEME_KEY = 'qfThemeMode'; // 'system' | 'dark' | 'light'

  function applyThemeMode(mode) {
    const root = document.documentElement;

    if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
    } else if (mode === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      // "system" – fall back to prefers-color-scheme
      root.removeAttribute('data-theme');
    }

    const badgeText = document.getElementById('themeBadgeText');
    if (badgeText) {
      let label = 'Theme: System';
      if (mode === 'light') label = 'Theme: Light';
      if (mode === 'dark') label = 'Theme: Dark';
      badgeText.textContent = label;
    }
  }

  function initThemeControls() {
    const select = document.getElementById('themeMode');
    if (!select) return;

    const defaultMode = 'system';
    const hasChromeStorage =
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.sync;

    // Load stored value (or default) and apply it
    if (hasChromeStorage) {
      try {
        chrome.storage.sync.get({ [THEME_KEY]: defaultMode }, (items) => {
          const mode = (items && items[THEME_KEY]) || defaultMode;
          select.value = mode;
          applyThemeMode(mode);
        });
      } catch (err) {
        console.error('Ghostwriter for Anki: failed to read theme from storage', err);
        select.value = defaultMode;
        applyThemeMode(defaultMode);
      }
    } else {
      let stored = null;
      try {
        if (window.localStorage) {
          stored = localStorage.getItem(THEME_KEY);
        }
      } catch (err) {
        console.warn('Ghostwriter for Anki: localStorage unavailable for theme', err);
      }
      const mode = stored || defaultMode;
      select.value = mode;
      applyThemeMode(mode);
    }

    // Persist and apply on change
    select.addEventListener('change', () => {
      const mode = select.value || defaultMode;
      applyThemeMode(mode);

      if (hasChromeStorage) {
        try {
          chrome.storage.sync.set({ [THEME_KEY]: mode });
        } catch (err) {
          console.error('Ghostwriter for Anki: failed to save theme to storage', err);
        }
      } else {
        try {
          if (window.localStorage) {
            localStorage.setItem(THEME_KEY, mode);
          }
        } catch (err) {
          console.warn('Ghostwriter for Anki: localStorage unavailable for theme save', err);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeControls);
  } else {
    initThemeControls();
  }
})();
