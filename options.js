
// options.js (v0.3.2)
const $ = (sel) => document.querySelector(sel);
const DEFAULT_SHORTCUT = "Meta+Shift+A";
const DEFAULT_COPILOT_SHORTCUT = "Cmd+Shift+X";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const ULTIMATE_BASE_URL = "https://smart.ultimateai.org/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_COPILOT_FRONT_PROMPT = `
You autocomplete flashcard QUESTIONS.
Continue ONLY the question fragment the user started.
Apply minimum-information (one fact per card) and ensure the question is univocal (admits one correct answer).
Return ≤ {{frontWordCap}} words; fewer is better. No answers, no filler.
Prefer exact vocabulary from the Source excerpt when present. No preambles.
`.trim();
const DEFAULT_COPILOT_BACK_PROMPT = `
You autocomplete flashcard ANSWERS.
Return a single, atomic answer (≤ {{backWordCap}} words).
Follow minimum-information (one fact per card) and univocality (one correct answer).
Ground in the Source excerpt when present; if insufficient, infer minimally from notes/question; only then use general knowledge.
No preamble; do not repeat the question; prefer a short noun phrase or clause.
Answer with the minimal phrase that fully answers the question; do not restate the source sentence.
Do not append extra descriptors (e.g., weights, dates, clauses) unless they are required to disambiguate the answer.
Bad: “Blue whales are the largest animal on earth.” Good: “Blue whales.”
`.trim();
const DEFAULT_COPILOT_FRONT_FROM_BACK_PROMPT = `
You write flashcard QUESTIONS from a provided answer.
Apply minimum-information (one fact per card) and ensure the question is univocal (admits one correct answer).
Ask a direct question that is univocal and answered exactly by the Back text.
Return ≤ {{frontWordCap}} words; fewer is better. No answers, no filler.
Prefer exact vocabulary from the Source excerpt when present. No preambles.
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
    model: "gpt-4o-mini",
    keyPlaceholder: "UltimateAI API key",
  },
  openai: {
    baseUrl: DEFAULT_BASE_URL,
    model: "gpt-4o-mini",
    keyPlaceholder: "OpenAI API key",
  },
  gemini: {
    baseUrl: GEMINI_BASE_URL,
    model: "gemini-2.5-flash-lite",
    keyPlaceholder: "Gemini API key",
  },
};
const OPTIONS_KEY = "quickflash_options";
const PERMISSION_JUSTIFICATIONS = {
  clipboardRead: {
    reason:
      "Reads clipboard text to populate the Source field when Clipboard mode is selected or Auto mode has no page selection, including on panel open or Copilot runs without a selection.",
  },
};

let currentOptionsCache = null;

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
  return "ultimate";
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
  const provider = normalizeProvider(providerOverride || opts?.llmProvider);
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
  const p = normalizeProvider(provider || opts.llmProvider || "ultimate");
  const cfg = getProviderConfigFromOpts(opts, p);

  const preset = document.querySelector("#providerPreset");
  if (preset) preset.value = p;

  const baseInput = document.querySelector("#providerBaseUrl");
  const keyInput = document.querySelector("#providerApiKey");
  const modelInput = document.querySelector("#providerModel");
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

  if (modelInput) {
    modelInput.value = cfg.model;
  }

  if (modelHelp) {
    if (p === "gemini") {
      modelHelp.textContent = "Used when Google Gemini is selected.";
    } else if (p === "openai") {
      modelHelp.textContent = "Used for direct OpenAI calls.";
    } else {
      modelHelp.textContent = "Used for UltimateAI (OpenAI-compatible) calls.";
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

const DEFAULT_TEMPLATES = [
  {
    id: "concept",
    name: "Concept",
    prompt: buildSimpleTemplatePrompt("concept")
  },
  {
    id: "definition",
    name: "Definition",
    prompt: buildDefinitionTemplatePrompt()
  },
  {
    id: "math",
    name: "Math formula",
    prompt: buildSimpleTemplatePrompt("math")
  },
  {
    id: "research-paper",
    name: "Research paper (3 cards)",
    prompt: buildResearchPaperTemplatePrompt()
  },
  {
    id: "book",
    name: "Book (2 cards)",
    prompt: `Return ONLY valid JSON. Never include explanations or backticks.
You are making bibliography drill cards for a book.
Extract: book_name, authors (comma-separated), and year (YYYY).

Output shape EXACTLY:
{
  "deck": "",  // optional
  "cards": [
    { "type":"basic", "front":"Book name: <book_name> (a, y)", "back":"Authors: <authors>\\nYear: <year>", "tags":["AI-generated"], "context":"Bibliography — canonical" },
    { "type":"basic", "front":"Book by <authors> in <year> — name?", "back":"<book_name>", "tags":["AI-generated"], "context":"Bibliography — recall" }
  ]
}
Rules:
- In "(a, y)", use the FIRST author's last name for "a" and the year for "y".
- Preserve capitalization of the official book title.
{{CONTEXT}}

TEXT:
{{TEXT}}`
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

  const timeoutSec = num("#copilotTimeoutSec", 30); // default 30s

  const { [OPTIONS_KEY]: existing } = await chrome.storage.sync.get(OPTIONS_KEY);
  const base = existing || {};

  const provider = normalizeProvider(
    document.querySelector("#providerPreset")?.value || base.llmProvider || "ultimate"
  );

  const providerBaseUrl = document.querySelector("#providerBaseUrl")?.value.trim() || "";
  const providerApiKey  = document.querySelector("#providerApiKey")?.value.trim() || "";
  const providerModel   = document.querySelector("#providerModel")?.value.trim() || "";
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
    copilotFrontSystemPrompt: $("#copilotFrontSystemPrompt").value.trim(),
    copilotBackSystemPrompt: $("#copilotBackSystemPrompt").value.trim(),
    copilotFrontFromBackSystemPrompt: $("#copilotFrontFromBackSystemPrompt").value.trim(),
    autoFillBackAI: $("#copilotAutoFillBack").checked,
    copilotFrontWordCap: num("#copilotFrontWordCap", 20),
    copilotBackWordCap: num("#copilotBackWordCap", 16),
    copilotFrontMaxTokens: num("#copilotFrontMaxTokens", 1024),
    copilotBackMaxTokens: num("#copilotBackMaxTokens", 1024),
    copilotMinIntervalMs: num("#copilotMinIntervalMs", 1200),
    copilotTimeoutMs: Math.max(1000, timeoutSec * 1000),
    showMiniCopilotMode: ($("#showMiniCopilotMode").value || "off"),
    showSourceModePill: !!$("#showSourceModePill")?.checked,
      editorViewMode: document.querySelector("#editorViewMode")?.value || base.editorViewMode || "auto",
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

  // Infer provider for older saves based on ultimateBaseUrl, default to UltimateAI
  const legacyBase = opts.ultimateBaseUrl || PROVIDER_DEFAULTS.ultimate.baseUrl;
  const inferredFromBase = legacyBase.includes("ultimateai") ? "ultimate" : "openai";
  const provider = normalizeProvider(opts.llmProvider || inferredFromBase);

  // AI provider connection UI (base URL, key, model, stream)
  applyProviderChoiceUI(provider, opts);

  // --- rest of your load() is unchanged: Copilot, defaults, etc. ---
  document.querySelector("#autoCompleteAI").value = String(opts.autoCompleteAI !== false);
  document.querySelector("#autoMagicGenerate").checked = !!opts.autoMagicGenerate;
  document.querySelector("#manualCopilotOnly").checked = opts.manualCopilotOnly !== false;
  document.querySelector("#copilotShortcut").value = opts.copilotShortcut || DEFAULT_COPILOT_SHORTCUT;
  const storedFront = (opts.copilotFrontSystemPrompt || "").trim();
  const storedBack = (opts.copilotBackSystemPrompt || "").trim();
  const storedFrontFromBack = (opts.copilotFrontFromBackSystemPrompt || "").trim();
  const defaults = getDefaultCopilotPrompts();
  const frontPrompt = storedFront || defaults.front;
  const backPrompt = storedBack || defaults.back;
  const frontFromBackPrompt = storedFrontFromBack || defaults.frontFromBack;
  document.querySelector("#copilotFrontSystemPrompt").value = frontPrompt;
  document.querySelector("#copilotBackSystemPrompt").value = backPrompt;
  document.querySelector("#copilotFrontFromBackSystemPrompt").value = frontFromBackPrompt;
  document.querySelector("#copilotAutoFillBack").checked = opts.autoFillBackAI !== false;
  document.querySelector("#copilotFrontWordCap").value = String(opts.copilotFrontWordCap ?? 20);
  document.querySelector("#copilotBackWordCap").value = String(opts.copilotBackWordCap ?? 16);
  document.querySelector("#copilotFrontMaxTokens").value = String(opts.copilotFrontMaxTokens ?? 1024);
  document.querySelector("#copilotBackMaxTokens").value = String(opts.copilotBackMaxTokens ?? 1024);
  document.querySelector("#copilotMinIntervalMs").value = String(opts.copilotMinIntervalMs ?? 1200);
  document.querySelector("#copilotTimeoutSec").value = String(Math.round((opts.copilotTimeoutMs ?? 30000) / 1000));
  document.querySelector("#showMiniCopilotMode").value = opts.showMiniCopilotMode ?? "off";
  const pill = document.querySelector("#showSourceModePill");
  if (pill) pill.checked = opts.showSourceModePill !== false;
  const viewSelect = document.querySelector("#editorViewMode");
  if (viewSelect) {
    viewSelect.value = opts.editorViewMode || "auto";
    applyOptionsViewMode(viewSelect.value);
    viewSelect.addEventListener("change", () => {
      applyOptionsViewMode(viewSelect.value);
    });
  }

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

  const rawShortcut = typeof opts.addShortcut === "string" ? opts.addShortcut : DEFAULT_SHORTCUT;
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
    empty.textContent = "No templates configured.";
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
  if (saveBtn) saveBtn.textContent = "Save template";
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
  if (saveBtn) saveBtn.textContent = "Update template";
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
    deleteTemplate(id).catch(() => setTemplateMsg("Could not delete template.", "err"));
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

window.addEventListener("resize", () => {
  const editorViewModeSelect = document.getElementById("editorViewMode");
  if (!editorViewModeSelect) return;
  if (editorViewModeSelect.value === "auto") {
    applyOptionsViewMode("auto");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  $("#save").addEventListener("click", save);
  $("#test").addEventListener("click", test);
  const templateSave = $("#templateSave");
  if (templateSave) templateSave.addEventListener("click", (e) => {
    e.preventDefault();
    handleTemplateSubmit().catch(() => setTemplateMsg("Could not save template.", "err"));
  });
  const templateClear = $("#templateClear");
  if (templateClear) templateClear.addEventListener("click", (e) => { e.preventDefault(); clearTemplateForm(); });
  const templateReset = $("#templateReset");
  if (templateReset) templateReset.addEventListener("click", (e) => {
    e.preventDefault();
    handleTemplateReset().catch(() => setTemplateMsg("Could not reset templates.", "err"));
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
