// prompts.js — optional overrides for system prompts and the prompt "template".
// These are loaded by panel.html before panel.js and picked up automatically.

window.QUICKFLASH_PROMPTS = {
  // System prompt for FRONT (questions)
  frontSystem: `
Autocomplete one Anki Front field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Complete the prefix into one durable retrieval cue: one target, unambiguous, enough context, no answer leakage.
Cue, don't disclose: identify the minimal Back answer, then leave that answer missing from the Front.
Use only facts grounded in the Source, title, notes, or existing card fields; do not add outside definitions or related trivia.
If the completion would need an answer-bearing phrase such as "by defining", "using", "where", or "namely", stop before that phrase.
Prefer a direct question. For command prefixes like State/Define/Name/List, complete the object of the command.
Do not copy, paraphrase, or continue the Source text unless the Prefix is already an exact source stem.
Keep the full Front <= {{frontWordCap}} words. Preserve the user's target; do not switch to easier source trivia.
  `.trim(),

  // System prompt for BACK (answers)
  backSystem: `
Autocomplete one Anki Back field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Return exactly one atomic answer. Obey this length cap strictly: <= {{backWordCap}} words.
In most cases the answer should be a bare noun phrase, name, term, value, or short clause.
Use a full sentence only if the Front explicitly asks for a definition, explanation, or sentence completion.
Answer exactly what the Front asks. Do not restate the Front or turn the Back into a passage summary.
Do not append unasked dates, locations, relative clauses, or descriptors unless required to disambiguate.
  `.trim(),

  // System prompt for "front-from-back" (Back → Front)
  frontFromBackSystem: `
Autocomplete one Anki Front field from an existing Back answer.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Use the Back as the answer contract. Ask for exactly one target with enough context and no answer leakage.
Keep the full Front <= {{frontWordCap}} words. Cue the Back answer while leaving that answer missing.
  `.trim(),

  // System prompt for CLOZE cards (the Text field, which carries {{c1::...}} deletions)
  clozeSystem: `
Autocomplete one Anki Cloze card's Text field.
Output only the text to insert. No analysis, labels, quotes, markdown, or "The user".
Continue after the user's prefix; do not repeat, correct, or restate text already typed.
Produce a single, self-contained sentence containing AT LEAST ONE cloze deletion in exact Anki format: {{c1::answer}}. Use {{c2::...}}, {{c3::...}} for additional independent deletions.
Wrap only the key term(s) to be recalled inside the deletion(s); keep enough surrounding context that the sentence is unambiguous. Never wrap the whole sentence, and never return zero deletions.
Keep each deletion atomic (one fact each) and grounded strictly in the Source, title, notes, or existing text; do not add outside facts.
The sentence together with its deletion(s) IS the whole card: do not write a separate question or answer.
Keep the sentence <= {{frontWordCap}} words, not counting the cloze markup.
  `.trim(),

  /**
   * Optional: replace the entire "user" prompt template.
   * This function receives the same inputs the panel uses to build the prompt.
   */
  buildUserPrompt(meta) {
    // meta.fieldId: "front" | "back"
    // meta.existing: string  (what the user has typed in the active field)
    // meta.other:    string  (the opposite field)
    // meta.protectedAnswer: string (answer inferred from source; forbidden on Front)
    // meta.answerRole: { kind, instruction } | null
    // meta.sourceStem: { kind, prefix, continuationPreview } | null
    // meta.prefixEndsWithSpace: boolean
    // meta.notes:    string  (#notes textarea)
    // meta.page:     { selection, title, url }
    // meta.caps:     { frontWordCap, backWordCap }
    const { fieldId, existing, other, notes, page, caps, sourceStem, prefixEndsWithSpace, cloze } = meta;
    const clip = (s, n = 240) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
    const role = cloze ? "CLOZE TEXT" : fieldId === "back" ? "BACK" : "FRONT";
    const oppositeLabel = fieldId === "back" ? "Front" : "Back";
    const hasExisting = !!(existing && existing.trim());
    const sourceCap = fieldId === "back" ? 360 : 280;
    const frontCap = Number(caps?.frontWordCap) || 18;
    const backCap = Number(caps?.backWordCap) || 14;
    const pageSource = page?.sourceText || page?.selection || "";
    const sourceHasLatex = /(?:\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\]|\\(?:frac|partial|sum|int|sqrt|alpha|beta|gamma|delta|nabla|rightarrow|Rightarrow)\b)/.test(pageSource);

    const lines = [
      `Complete ${role}. Output text only.`,
      hasExisting
        ? `Prefix: ${clip(existing, 160)}${prefixEndsWithSpace ? " (ends with a space; last word is complete)" : ""}`
        : "",
      sourceStem?.continuationPreview
        ? `Source-stem match: Prefix already matches source text; exact continuation begins "${clip(sourceStem.continuationPreview, 100)}".`
        : "",
      fieldId === "back" && other
        ? `Front: ${clip(other, 220)}`
        : other
        ? `${oppositeLabel}: ${clip(other, 180)}`
        : "",
      notes ? `Notes: ${clip(notes, 120)}` : "",
      page?.title ? `Title: ${clip(page.title, 80)}` : "",
      sourceHasLatex
        ? "Math rule: the Source contains TeX/LaTeX; preserve exact source TeX spans for mathematical expressions. Do not convert them to Unicode or plaintext."
        : "",
      "Rules:",
      "- Continue after Prefix; do not repeat, correct, or restate text already typed.",
      "- Preserve the user's target from Prefix/Front/Back before using the Source.",
      cloze
        ? "- Source-grounding: the sentence and every deletion must be answerable from the Source/title/notes only; do not introduce outside facts."
        : "- Source-grounding: Front and Back must be answerable from the Source/title/notes/card fields only; do not introduce outside definitions, fields, or related facts.",
      cloze ? "- CLOZE: output ONE sentence containing at least one deletion in {{c1::answer}} format (add {{c2::}}, {{c3::}} for more); never zero deletions." : "",
      cloze ? "- CLOZE: wrap only the key term(s) to recall and keep surrounding context; each deletion atomic and source-grounded." : "",
      cloze ? "- CLOZE: the sentence with its deletion(s) is the whole card; do not add a separate question/answer or copy the Source verbatim." : "",
      !cloze ? `- FRONT: one atomic cue, full Front <= ${frontCap} words, unambiguous, enough context, no answer leakage.` : "",
      !cloze ? "- FRONT: prefer a direct question; for command prefixes like State/Define/Name/List, complete the object of the command." : "",
      !cloze ? "- FRONT: do not copy, paraphrase, or continue the Source text unless the Prefix is already an exact source stem." : "",
      !cloze ? "- FRONT: stop before answer-bearing phrases such as \"by defining\", \"using\", \"where\", or \"namely\"." : "",
      !cloze ? `- BACK: one atomic answer <= ${backCap} words, usually a bare noun phrase/name/term/value/short clause.` : "",
      !cloze ? "- BACK: do not restate the Front, summarize the passage, or add unasked dates/descriptors." : "",
      cloze
        ? "- If a source-grounded cloze sentence is possible, output it; output nothing only when no atomic deletion is supported."
        : "- If a source-grounded atomic cue is possible, complete it; output nothing only when the target is unsupported, unclear, or non-atomic.",
    ].filter(Boolean);

    if (pageSource) lines.push(`Source:\n${clip(pageSource, sourceCap)}`);
    lines.push("Output:");

    return lines.join("\n");
  }
};
