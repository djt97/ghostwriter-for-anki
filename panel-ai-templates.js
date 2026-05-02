// panel-ai-templates.js — AI template prompt builders and template management.
// Loaded by panel.html before panel.js. All functions and constants are global.

function buildSimpleAITemplatePrompt(kind) {
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
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildSimpleAITemplatePromptWithMathRule(kind) {
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

function buildDefinitionAITemplatePrompt() {
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
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}

function buildResearchPaperAITemplatePrompt() {
  return `Return ONLY valid JSON. Never include explanations or backticks.
You are making bibliography drill cards for a research paper.
Extract: paper_name, authors (comma-separated), year (YYYY), and journal (official name if present).
If journal is unknown, use an em dash "\u2014" as the answer.

Output shape EXACTLY:
{
  "deck": "",  // optional
  "cards": [
    { "type":"basic", "front":"Paper Name: <paper_name> \u2013 (a,y)?", "back":"<authors> (<year>)", "tags":["AI-generated"], "context":"Bibliography \u2014 canonical" },
    { "type":"basic", "front":"<authors> (<year>) published in <journal> \u2013 paper name?", "back":"<paper_name>", "tags":["AI-generated"], "context":"Bibliography \u2014 recall" },
    { "type":"basic", "front":"\\"<paper_name>\\" \u2013 journal?", "back":"<journal>", "tags":["AI-generated"], "context":"Bibliography \u2014 journal" }
  ]
}
Rules:
- Keep "(a,y)?" exactly as written, do not replace it with author/year text.
- Preserve capitalization of the official paper and journal titles.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
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

function buildLegacyResearchPaperAITemplatePrompt() {
  return `Return ONLY valid JSON. Never include explanations or backticks.
You are making bibliography drill cards for a research paper.
Extract: paper_name, authors (comma-separated), year (YYYY), and journal (official name if present).

Output shape EXACTLY:
{
  "deck": "",  // optional
  "cards": [
    { "type":"basic", "front":"Paper Name: <paper_name> \u2013 (a,y)?", "back":"<authors> (<year>)", "tags":["AI-generated"], "context":"Bibliography \u2014 canonical" },
    { "type":"basic", "front":"<authors> (<year>) published in <journal> \u2013 paper name?", "back":"<paper_name>", "tags":["AI-generated"], "context":"Bibliography \u2014 recall" },
    { "type":"basic", "front":"\\"<paper_name>\\" \u2013 journal?", "back":"<journal>", "tags":["AI-generated"], "context":"Bibliography \u2014 journal" }
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
  const oldPrompt = buildSimpleAITemplatePrompt("definition").trim();
  const oldPromptWithMath = buildSimpleAITemplatePromptWithMathRule("definition").trim();
  const newPrompt = buildDefinitionAITemplatePrompt();
  let changed = false;
  const updated = (templates || []).map((tpl) => {
    if (
      tpl?.id === "definition"
      && typeof tpl.prompt === "string"
      && (tpl.prompt.trim() === oldPrompt || tpl.prompt.trim() === oldPromptWithMath)
    ) {
      changed = true;
      return { ...tpl, prompt: newPrompt };
    }
    return tpl;
  });
  return { updated, changed };
}

function upgradeResearchPaperPromptIfNeeded(templates) {
  const oldPrompt = buildLegacyResearchPaperAITemplatePrompt().trim();
  const newPrompt = buildResearchPaperAITemplatePrompt();
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

const DEFAULT_AI_TEMPLATES = [
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

let aiTemplates = cloneDefaultAITemplates();
let aiTemplatesLoaded = false;

function cloneAITemplateEntry(entry) {
  const id = entry?.id ? String(entry.id) : `template-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return {
    id,
    name: entry?.name ? String(entry.name) : id,
    prompt: entry?.prompt ? String(entry.prompt) : "",
    isCustom: typeof entry?.isCustom === "boolean" ? entry.isCustom : false,
  };
}

function cloneDefaultAITemplates() {
  return DEFAULT_AI_TEMPLATES.map((tpl) => ({
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

function normalizeStoredAITemplate(entry, defaultsById) {
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

function reconcileAiTemplatesWithDefaults(stored, applyUpdates) {
  const defaults = cloneDefaultAITemplates();
  const defaultsById = new Map(defaults.map((tpl) => [tpl.id, tpl]));
  const raw = Array.isArray(stored) ? stored : [];
  const filtered = raw.filter((tpl) => tpl && typeof tpl.prompt === "string");
  const normalized = filtered.map((tpl) => normalizeStoredAITemplate(tpl, defaultsById));
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

function populateAiTemplateSelect(list) {
  const sel = document.querySelector("#editorTemplateSelect");
  if (!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = "";
  for (const tpl of list || []) {
    const opt = document.createElement("option");
    opt.value = tpl.id;
    opt.textContent = tpl.name || tpl.id;
    sel.appendChild(opt);
  }
  if (!list || !list.length) return;
  if (list.some((tpl) => tpl.id === prevValue)) {
    sel.value = prevValue;
  } else {
    sel.value = list[0].id;
  }
}

function getAiTemplateList() {
  return (Array.isArray(aiTemplates) && aiTemplates.length)
    ? aiTemplates
    : cloneDefaultAITemplates();
}

async function ensureAiTemplatesLoaded(force = false) {
  if (aiTemplatesLoaded && !force) {
    populateAiTemplateSelect(getAiTemplateList());
    return aiTemplates;
  }
  try {
    const opts = await getOptions();
    const updateMode = getTemplateUpdateMode(opts);
    const data = await chrome.storage.sync.get("quickflash_templates");
    const stored = Array.isArray(data?.quickflash_templates) ? data.quickflash_templates : [];
    const { templates, changed } = reconcileAiTemplatesWithDefaults(
      stored,
      updateMode === TEMPLATE_UPDATE_MODES.apply
    );
    aiTemplates = templates;
    if (changed) {
      await chrome.storage.sync.set({ quickflash_templates: templates });
    }
  } catch {
    aiTemplates = cloneDefaultAITemplates();
  }
  aiTemplatesLoaded = true;
  populateAiTemplateSelect(getAiTemplateList());
  return aiTemplates;
}

function buildFallbackAiPrompt(templateId) {
  const name = templateId || "custom";
  return `Return ONLY valid JSON. Never include explanations or backticks.
Make exactly one source-grounded flashcard using the suggestion mode: ${name}.
Output shape:
{ "cards": [ { "type":"basic", "front":"...", "back":"...", "tags":["AI-generated"] } ] }
Preserve the user's apparent target, make one stable retrieval cue, and keep the answer minimal.
Avoid vague context, multiple valid answers, shallow textbook lists, and passage restatement.
If there is not enough source, return { "cards": [] }.
{{CONTEXT}}

TEXT:
{{TEXT}}`;
}
