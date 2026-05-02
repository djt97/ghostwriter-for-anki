// prompts.js — optional overrides for system prompts and the prompt "template".
// These are loaded by panel.html before panel.js and picked up automatically.

window.QUICKFLASH_PROMPTS = {
  // System prompt for FRONT (questions)
  frontSystem: `
Autocomplete one Anki Front field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Complete the user's prefix into one durable retrieval cue: one target, unambiguous, enough context, no answer leakage.
Cue, don't disclose: silently identify the minimal Back answer, then write a Front that asks for it without revealing the method, formula, definition, result, name, or example.
If the completion would need "by defining", "using", "where", "namely", or another answer-bearing phrase, stop before that phrase.
Preserve the user's intended target; do not switch to easier source trivia.
  `.trim(),

  // System prompt for BACK (answers)
  backSystem: `
Autocomplete one Anki Back field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Answer the Front exactly. Prefer the smallest source-grounded phrase.
Supply the missing answer the Front cues; do not turn the Back into a passage summary.
Do not restate the passage or add background unless needed to disambiguate.
  `.trim(),

  // System prompt for "front-from-back" (Back → Front)
  frontFromBackSystem: `
Autocomplete one Anki Front field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Use the Back as the answer contract. Ask for exactly one target with enough context and no answer leakage.
Cue, don't disclose: the Front must point at the Back answer while leaving that answer missing.
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
    const { fieldId, existing, other, notes, page } = meta;
    const clip = (s, n = 240) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
    const role = fieldId === "back" ? "BACK" : "FRONT";
    const oppositeLabel = fieldId === "back" ? "Front" : "Back";
    const hasExisting = !!(existing && existing.trim());
    const sourceCap = fieldId === "back" ? 320 : 220;

    return [
      `Complete ${role}. Output text only.`,
      hasExisting
        ? `Prefix: ${clip(existing, 160)}`
        : "",
      fieldId === "back" && other
        ? `Front: ${clip(other, 220)}`
        : other
        ? `${oppositeLabel}: ${clip(other, 180)}`
        : "",
      notes ? `Notes: ${clip(notes, 120)}` : "",
      page?.selection ? `Source: ${clip(page.selection, sourceCap)}` : "",
      page?.title ? `Title: ${clip(page.title, 80)}` : "",
      "Rules:",
      "- No task narration or labels.",
      "- Continue after Prefix; do not repeat, correct, or restate text already typed.",
      "- Preserve the user's target from Prefix/Front/Back before using the Source.",
      "- FRONT: one atomic cue, unambiguous, enough context, no answer leakage.",
      "- FRONT cue-don't-disclose: silently identify the minimal Back answer, then leave the method/formula/definition/result/name/example missing.",
      "- FRONT must stop before answer-bearing phrases such as \"by defining\", \"using\", \"where\", or \"namely\".",
      "- BACK: minimal answer, source-grounded, no passage restatement.",
      "- If the target is unsupported or unclear, output nothing.",
      "Output:"
    ].filter(Boolean).join("\n");
  }
};
