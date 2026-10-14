/* global module */
// card-checks.js — Offline checks of a finished card ("Check my card"). No model calls.
//
// Each check looks for a construction fault that makes a card fail in review: a cue with no
// single answer, or a back with more than one fact. The wording of the messages follows
// published card-writing advice and DJ's house style. Faults of fact or understanding are out
// of scope: no offline check can see them.

(function (root) {
  // Text to check: HTML, Obsidian block ids and "Open in Obsidian" links removed; math spans
  // replaced by a placeholder so their punctuation doesn't look like sentence structure.
  function plainText(value) {
    return String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/\s\^[0-9a-z]{6,}\b/gi, " ")
      .replace(/📝[^\n]*/gu, " ")
      .replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g, " MATH ")
      .replace(/\\\([\s\S]*?\\\)|\$[^$\n]+\$/g, " MATH ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  const words = (text) => (String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []);
  const lower = (text) => String(text || "").toLowerCase();

  // A front that announces a count or a contrast licenses a two-part back ("What two..."),
  // per "a pair the front announces" and "a contrast in two parallel clauses".
  function frontAnnouncesSeveral(front) {
    return /\b(?:two|three|four|five|six|seven|eight|nine|ten|both|pair|several|list|name\s+(?:the\s+)?\w+\s+\w+s|differ|difference|distinguish|contrast|compare|unlike|versus|vs\.?)\b/i.test(front);
  }

  const YES_NO = /^(?:is|are|was|were|do|does|did|can|could|will|would|should|has|have|had|must|may|might)\s+\S+/i;
  const TWO_ALTERNATIVES = /\b([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+)?)\s+or\s+([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+)?)\s*\?\s*$/iu;
  const EMPTY_FRAMES = [
    /\bwhat\s+(?:role|part)\s+does\b/i,
    /\bwhat\s+happens\s+(?:to|when|in|if)\b/i,
    /\bwhat\s+is\s+the\s+(?:relationship|relation|connection|link|significance|importance|purpose|point|role|nature|idea|story|deal)\b/i,
    /\bwhat\s+(?:is|are)\s+the\s+(?:main\s+|key\s+)?(?:features|characteristics|aspects|properties|implications|consequences)\s+of\b/i,
    /\bwhy\s+is\b.*\b(?:so\s+)?(?:important|significant|surprising|interesting|useful)\s*\??$/i,
    /\bhow\s+(?:do|does)\b.*\bexperience\b/i,
    /\btell\s+me\s+about\b/i,
    /\bwhat\s+about\b/i,
    /\bwhat\s+(?:kind|sort)\s+of\s+(?:phenomena|things|stuff)\b/i,
  ];
  const OPEN_COMMANDS = /^(?:explain|describe|discuss|summari[sz]e|talk\s+about|elaborate)\b/i;
  const VAGUE_CUES = /\b(?:intuitively|in\s+practical\s+terms|roughly\s+speaking|give\s+(?:an?\s+|\d+\s+|some\s+|several\s+)?examples?)\b/i;
  const ONE_SIDED_COMPARISON = /\b(?:what\s+distinguishes|how\s+(?:does|do|is|are)\s+[^?]*\bdiffer(?:ent)?)\b(?![^?]*\b(?:from|between|than|and|unlike|versus|vs\.?)\b)/i;
  // A dummy "it" after "is"/"was" ("Why is it important to...", "How is it that...") points at
  // nothing, so it doesn't count.
  const DUMMY_IT = /^(?:what|why|how|when|where|which|who)\s+(?:is|was)\s+it\s+(?:(?:(?:so|very|more|less|\w+ly)\s+)?\w+\s+(?:to|that|for|whether|if)\b|that\b)/i;
  const COLD_START = /^(?:(?:what|why|how|when|where|which|who)\s+(?:does|do|is|are|was|were|did|can|could)\s+(?:it|this|that|they|these|those)\b(?!\s+(?:called|mean))|(?:it|this|they|these|those)\s+(?:is|are|was|were|does|do|did|can)\b)/i;
  const PRONOUN_LABEL = /\b(?:the\s+(?:above|previous|former|latter)|as\s+(?:above|before))\b/i;
  const ALTERNATE_FORMS = /\((?:or|a\.?k\.?a\.?|also(?:\s+called|\s+known\s+as)?|i\.e\.)\b|\b(?:also\s+(?:called|known\s+as)|a\.k\.a\.|otherwise\s+known\s+as)\b/i;

  function sentenceCount(text) {
    const cleaned = String(text || "")
      .replace(/\b(?:e\.g|i\.e|etc|vs|v|cf|al|approx|Dr|Mr|Mrs|Ms|St|No|Fig|Eq|resp)\./gi, "")
      .replace(/\b[A-Z]\./g, "")
      .replace(/\d\.\d/g, "0");
    return (cleaned.match(/[^.!?]+[.!?]+(?=\s+[A-Z(]|\s*$)/g) || []).filter((s) => words(s).length >= 2).length || 1;
  }

  function listItemCount(text) {
    const lines = String(text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const bulletLines = lines.filter((l) => /^(?:[-*•]|\d+[.)])\s+/.test(l)).length;
    if (bulletLines >= 2) return bulletLines;
    const inline = String(text || "").match(/(?:^|\s)\(?\d+[.)]\s+\S/g);
    if (inline && inline.length >= 2) return inline.length;
    // "A, B and C" or "A, B, C": three or more items in one sentence.
    const sentence = String(text || "").replace(/\([^)]*\)/g, "");
    const parts = sentence.split(/,\s*|\s+(?:and|or)\s+/i).map((p) => p.trim()).filter(Boolean);
    const short = parts.filter((p) => words(p).length <= 5);
    if (/,/.test(sentence) && /\b(?:and|or)\b/i.test(sentence) && parts.length >= 3 && short.length === parts.length) return parts.length;
    return 0;
  }

  // Content words of the back that also appear on the front, compared by a crude stem.
  const STOP = new Set([
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "by", "with", "and", "or", "is", "are", "was", "were", "be",
    "it", "its", "that", "this", "as", "from", "into", "than", "their", "his", "her", "they", "them", "which", "what", "who", "math",
    // Instruction words on a back ("Define ...", "Take ...") are not the answer.
    "define", "write", "state", "take", "use", "given", "show", "prove", "note", "then",
  ]);
  const stem = (w) => lower(w).replace(/(?:ies|es|s|ing|ed|ly)$/i, "");
  function answerOnFront(front, back) {
    const backWords = words(back).filter((w) => !STOP.has(lower(w)) && w.length >= 4);
    if (!backWords.length || backWords.length > 3) return false;
    const frontStems = new Set(words(front).map(stem));
    return backWords.every((w) => frontStems.has(stem(w)));
  }

  function checkCard({ front = "", back = "" } = {}) {
    // A card is short; a long paste (a table, a list) is clipped so the sentence count stays fast.
    const f = plainText(front).slice(0, 2000);
    const b = plainText(back).slice(0, 2000);
    const flags = [];
    // "warn" for a likely fault, "note" for a smell worth a second look.
    const add = (id, field, message, severity = "warn") => flags.push({ id, field, message, severity });
    if (!f) return flags;
    const frontQuestion = f.replace(/\s+/g, " ").trim();

    if (YES_NO.test(frontQuestion) && /\?\s*$/.test(frontQuestion) && !TWO_ALTERNATIVES.test(frontQuestion)) {
      add("yes-no", "front", "Yes/no question: it can be guessed half the time and tests recognition, not recall. Ask for the property, condition or counterexample instead.");
    }
    if (TWO_ALTERNATIVES.test(frontQuestion) && !/\bwhether\b/i.test(frontQuestion)) {
      add("two-alternatives", "front", "The question offers two alternatives, so it is a coin flip. Ask for the value or property directly.");
    }
    if (EMPTY_FRAMES.some((re) => re.test(frontQuestion))) {
      add("empty-frame", "front", "Empty frame: a question like this fits many answers. Name the property you want, or ask the direct why.");
    }
    if (OPEN_COMMANDS.test(frontQuestion)) {
      add("open-command", "front", "\"Explain\" or \"Describe\" invites an essay. Ask What, Which, When, Why, Define or State for one specific point.");
    }
    if (VAGUE_CUES.test(frontQuestion)) {
      add("vague-cue", "front", "Vague cue (\"intuitively\", \"give an example\"): there is no single stable answer. Tighten the question.");
    }
    if (ONE_SIDED_COMPARISON.test(frontQuestion)) {
      add("one-sided-comparison", "front", "A comparison should name both sides: \"What distinguishes X from Y?\".");
    }
    if ((COLD_START.test(frontQuestion) && !DUMMY_IT.test(frontQuestion)) || PRONOUN_LABEL.test(frontQuestion)) {
      add("cold-start", "front", "The question leans on something not on the card (\"it\", \"this\", \"the above\"). Spell it out so the card can be answered cold.");
    }
    if (b && answerOnFront(f, b)) {
      add("answer-on-front", "front", "The answer already appears on the front. Remove it, or reverse the card.");
    }

    if (b) {
      const several = frontAnnouncesSeveral(f);
      const backWordCount = words(b.replace(/\bMATH\b/g, "")).length + (b.match(/\bMATH\b/g) || []).length;
      const items = listItemCount(b);
      // A short list the front asks for ("the three levels of supervision") is one fact; a long
      // one is still too much for one card.
      if (items >= 3 && (!several || items >= 4 || backWordCount > 10)) {
        add("list-back", "back", `The back is a list of ${items} items. A list means several cards.`);
      } else if (!several && (sentenceCount(b) >= 2 || /;\s*\S/.test(b) || /\s[—–]\s|\s--\s/.test(b))) {
        // A note, not a warning: raters in the Memory Machines study accept two-sentence answers
        // (often to why-questions) that a strict one-fact rule would flag.
        add("two-facts", "back", "The back may hold more than one fact (a second sentence, semicolon or dash). If so, keep the fact the front asks for and give the rest its own card.", "note");
      }
      if (ALTERNATE_FORMS.test(b)) {
        add("alternate-forms", "back", "One form of the answer: drop the alternative name or gloss in brackets, or give it its own card.");
      }
      // A contrast or an announced pair needs more words; elsewhere over 15 is the smell.
      const wordLimit = several ? 25 : 15;
      if (backWordCount > wordLimit && !flags.some((x) => x.field === "back" && (x.id === "list-back" || x.id === "two-facts"))) {
        add("long-back", "back", `The back is ${backWordCount} words. Over ${wordLimit} words is a sign it should be split or trimmed.`, "note");
      }
    }
    return flags;
  }

  const api = { checkCard, plainText, sentenceCount, listItemCount, answerOnFront };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GHOSTWRITER_CARD_CHECKS = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
