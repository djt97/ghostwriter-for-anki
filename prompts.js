// prompts.js — optional overrides for system prompts and the prompt "template".
// These are loaded by panel.html before panel.js and picked up automatically.

window.QUICKFLASH_PROMPTS = {
  // System prompt for FRONT (questions)
  frontSystem: `
You autocomplete flashcard QUESTIONS.
Start with a question word (“What”, “Which”, “How”, “When”, “Where”, “Under what conditions”, “Why”, or “Define …”).
One fact per card (univocal). ≤ {{frontWordCap}} words. No answers, no filler.
Do NOT copy long phrases verbatim from the Source excerpt; paraphrase them.
Avoid meta phrases like “in the excerpt” or “in the passage.”
  `.trim(),

  // System prompt for BACK (answers)
  backSystem: `
You autocomplete flashcard ANSWERS for spaced‑repetition cards.
Return exactly one atomic answer. Obey this length cap strictly: ≤ {{backWordCap}} words.
In almost all cases the answer should be a bare noun phrase (name, term, or short phrase) with no verbs.
Only use a longer phrase or full sentence if the question explicitly asks for a definition, explanation, or sentence completion.
Ground yourself in the Source excerpt when present. No preamble; do NOT restate the question.
Answer with the minimal phrase that fully answers the question; do not restate the source sentence.
Do not append extra descriptors (e.g., weights, dates, locations, or relative clauses like “who…”, “that…”, “which…”) unless they are absolutely required to disambiguate the answer.
If the Front already states the property being asked about (e.g. “largest animal ever to live on Earth”, “capital of X”, “mass of Y”), answer ONLY with the entity or value, not the property again.
Example:
- Q: “What are the largest animals ever to live on Earth?” → A: “Blue whales”
Avoid meta phrases like “in the excerpt” or “in the passage.”
  `.trim(),

  // System prompt for "front-from-back" (Back → Front)
  frontFromBackSystem: `
You write flashcard QUESTIONS from a provided answer.
Ask a direct question that is univocal and answered exactly by the Back text.
Return ≤ {{frontWordCap}} words; fewer is better. No answers, no filler.
Prefer exact vocabulary from the Source excerpt when present. No preambles.
  `.trim(),

  /**
   * Optional: replace the entire "user" prompt template.
   * This function receives the same inputs the panel uses to build the prompt.
   */
  buildUserPrompt(meta) {
    // meta.fieldId: "front" | "back"
    // meta.existing: string  (what the user has typed in the active field)
    // meta.other:    string  (the opposite field)
    // meta.notes:    string  (#notes textarea)
    // meta.page:     { selection, title, url }
    // meta.caps:     { frontWordCap, backWordCap }
    const { fieldId, existing, other, notes, page, caps } = meta;
    const clip = (s, n = 600) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
    const role = fieldId === "back" ? "answer (Back)" : "question (Front)";
    const hasExisting = !!(existing && existing.trim());

    return [
      `You help write concise, high‑quality flashcards.`,
      hasExisting
        ? `Continue the ${role} after the existing words; do not repeat or alter the existing text.`
        : `Write the ${role} from scratch.`,
      fieldId === "back" && other
        ? `Front (question) currently says:\n"""${clip(other, 300)}"""`
        : other
        ? `${fieldId === "back" ? "Front" : "Back"} currently says:\n"""${clip(other, 300)}"""`
        : "",
      notes ? `Additional notes:\n"""${clip(notes, 300)}"""` : "",
      page?.selection ? `Source excerpt:\n"""${clip(page.selection, 600)}"""` : "",
      page ? `Page context: title="${clip(page.title, 120)}" url="${page.url || ""}"` : "",
      "Rules:",
      "- Prefer vocabulary from the excerpt for names/terms but paraphrase whole sentences.",
      `- FRONT: return ≤ ${caps.frontWordCap} words; begin with a question word; do not include the answer.`,
      `- BACK: return a single, standalone answer ≤ ${caps.backWordCap} words.`,
      "  - In almost all cases the answer should be a bare noun phrase (name, term, or short phrase) with no verbs.",
      "  - Do NOT repeat the question or restate information that already appears on the Front.",
      "  - Do NOT restate the source sentence or copy it with small edits.",
      "  - Do NOT add clauses like “who…”, “that…”, “which…”, or extra descriptions (weights, dates, locations, etc.) unless strictly required to disambiguate the answer.",
      "  - If the Front already specifies a property (e.g. “largest animal ever to live on Earth”, “capital of X”, “mass of Y”), answer ONLY with the entity or value, not the property again.",
      "- Return only the continuation text (no quotes, no labels).",
      hasExisting ? `\nExisting text:\n"""${clip(existing, 300)}"""\nContinuation:` : ""
    ].filter(Boolean).join("\n");
  }
};
