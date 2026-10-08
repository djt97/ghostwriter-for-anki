/* global module */
// anki-note.js — Pure helpers for turning a Ghostwriter card into Anki note fields.

(function (root) {
  // Fields Ghostwriter fills with metadata rather than the card's question or answer.
  const METADATA_FIELDS = new Set(["Context", "Source", "Notes", "Extra", "Back Extra"]);

  // Decide which of a note type's fields receive the card. Ghostwriter's own note types and
  // Anki's stock ones use Front/Back or Text/Extra; other note types fall back to their first
  // two content fields in Anki's order, so nothing is silently dropped.
  function resolveNoteFields(fieldNames) {
    const names = Array.isArray(fieldNames) ? fieldNames.filter((n) => typeof n === "string") : [];
    const has = (n) => names.includes(n);
    const content = names.filter((n) => !METADATA_FIELDS.has(n));
    const front = has("Front") ? "Front" : (content[0] || null);
    const back = has("Back") ? "Back" : (content.find((n) => n !== front) || null);
    const text = has("Text") ? "Text" : (content[0] || null);
    const extra = has("Extra") ? "Extra" : (has("Back Extra") ? "Back Extra" : null);
    return {
      front,
      back,
      text,
      extra,
      remapped: !!names.length && (!has("Front") || !has("Back")),
    };
  }

  // Why a source link must stay out of the answer field, given the note type's card templates
  // (AnkiConnect modelTemplates: { cardName: { Front, Back } }):
  //   "type"     a template asks to type the answer ({{type:Back}}), and Anki would grade the link
  //   "reversed" the answer field appears on a question side (e.g. Basic (and reversed card))
  // "" when it is safe, or when the templates are unknown.
  function sourceLinkUnsafeReason(templates, answerField) {
    if (!templates || typeof templates !== "object" || !answerField) return "";
    const name = String(answerField).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const typed = new RegExp(`\\{\\{type:(?:[^{}:]*:)?${name}\\}\\}`, "i");
    const shown = new RegExp(`\\{\\{(?:[^{}#/^]*:)?${name}\\}\\}`);
    const cards = Object.values(templates).filter((card) => card && typeof card === "object");
    if (cards.some((card) => typed.test(String(card.Front || "")) || typed.test(String(card.Back || "")))) return "type";
    if (cards.some((card) => shown.test(String(card.Front || "")))) return "reversed";
    return "";
  }

  const api = { resolveNoteFields, sourceLinkUnsafeReason, METADATA_FIELDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GHOSTWRITER_ANKI_NOTE = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
