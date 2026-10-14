// A judge for generated cards, grounded on the reader's own rated cards for the same highlight
// (the fixture's preferred, alternate and known-bad cards). Grounding a judge this way raised
// precision from 56% to 78% in the Memory Machines study (Kirkby & Matuschak, 2026).

const { anthropicJson } = require("./anthropic.js");

const JUDGE_SYSTEM = `You review flashcards for spaced-repetition review in Anki. A reader highlighted a passage and began typing the question (the prefix); an assistant completed the card. Decide whether the reader should keep this card for months of review.

Rate the card in one of four tiers:
- T3 Ready to review: asks about what the reader highlighted and started to ask; the question has one clear answer, which the Back gives correctly and concisely.
- T2 Needs polish: right target and correct answer, but wordy, awkward, or missing a small detail the reader would fix in seconds.
- T1 Needs refactor: looks plausible but would fail in review. The question admits several correct answers, lacks the context needed to know what is asked, gives the answer away, or asks for more facts than it announces.
- T0 Off-target or wrong: asks about something other than what the reader started to ask, or the Back is wrong according to the passage.

The reader's house rules:
- A yes/no question, or one that offers two alternatives, can be guessed: T1.
- An empty frame fits too many answers: "What inspired X?", "What does X enable?", "What role does X play?", "What happens to X?", "Why is X important?", or a bare "What is X?" about a broad concept. If several different answers would be correct out of context, T1; if one added word or qualifier fixes it, T2. A scoped "What is X?" ("According to Durkheim, what are religious beliefs?") is fine.
- A comparison names both sides.
- A list is fine only when the question says how many items it wants. Two facts are fine when the question asks for both ("Where and when...") or for a contrast.
- Terms the card is about may appear on both sides; only the answer itself must stay off the front.
- Wordiness or a long but correct Back is T2, not T1.

The reader's own rated cards for this passage are references. GOOD cards are ones they accept; NEEDS POLISH cards they would keep after a small fix; BAD cards are ones they rejected, with their reason. Judge the candidate as this reader would. A candidate that asks and answers what a GOOD card does is usually T3 or T2; a candidate that repeats the flaw of a BAD card gets the tier that flaw deserves. The references are examples, not the only acceptable cards.

Also say whether the Back correctly answers the Front according to the passage. Keep the reason under 30 words.`;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    tier: { type: "string", enum: ["T3", "T2", "T1", "T0"] },
    back_correct: { type: "boolean" },
    closest_reference: { type: "string" },
    reason: { type: "string" },
  },
  required: ["tier", "back_correct", "closest_reference", "reason"],
  additionalProperties: false,
};

const squash = (value) => String(value || "").replace(/\s+/g, " ").trim();
const cardKey = (card) => squash(card.type === "cloze" ? card.text : `${card.front} || ${card.back}`).toLowerCase();

function describeCard(card) {
  if (!card) return "";
  if (card.type === "cloze") return `Cloze: ${squash(card.text)}`;
  return `Front: ${squash(card.front)} | Back: ${squash(card.back)}`;
}

// The references for a row. When calibrating, a card identical to the candidate is left out (so
// a reference card is never judged against itself); when judging a generated card, it stays and
// is marked, so a model that reproduces a rated card gets that card's rating.
function buildReferences({ preferredCards = [], alternateCards = [], badButPlausibleCards = [] }, candidate, { maskCandidate = true } = {}) {
  const key = candidate ? cardKey(candidate) : "";
  const prepare = (list) => list.filter(Boolean).flatMap((card) => {
    if (!key || cardKey(card) !== key) return [card];
    return maskCandidate ? [] : [{ ...card, identical: true }];
  });
  return { good: prepare([...preferredCards, ...alternateCards]), bad: prepare(badButPlausibleCards) };
}

function buildJudgePrompt({ sourceText, prefix, candidate, references, readerNote = "", title = "" }) {
  const lines = [
    `Passage the reader highlighted:\n${squash(sourceText)}`,
    ...(title ? ["", `Page title: ${squash(title)}`] : []),
    "",
    `Prefix the reader typed: "${squash(prefix)}"`,
    "",
    `Candidate card:\n${describeCard(candidate)}`,
    "",
    "Reference cards rated by the reader:",
  ];
  if (!references.good.length && !references.bad.length) lines.push("(none)");
  const same = (card) => (card.identical ? " (identical to the candidate)" : "");
  for (const card of references.good) {
    const why = squash(card.rationale);
    lines.push(card.tier === "T2" ? `NEEDS POLISH${why ? ` (${why})` : ""}${same(card)}: ${describeCard(card)}` : `GOOD${same(card)}: ${describeCard(card)}`);
  }
  for (const card of references.bad) {
    const why = squash(card.whyBad || card.rationale);
    lines.push(`BAD${why ? ` (${why})` : ""}${same(card)}: ${describeCard(card)}`);
  }
  if (readerNote) lines.push("", `Reader's note on this passage: ${squash(readerNote)}`);
  return lines.join("\n");
}

async function openAiJson(config, { system, prompt, schema }) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "card_judgment", strict: true, schema } },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`judge ${config.provider} error ${response.status}: ${data?.error?.message || response.statusText}`);
  const text = data?.choices?.[0]?.message?.content || "";
  let value = null;
  try { value = JSON.parse(text); } catch {}
  const usage = data?.usage ? { inputTokens: data.usage.prompt_tokens || 0, outputTokens: data.usage.completion_tokens || 0 } : null;
  return { value, text, model: String(data?.model || config.model), usage };
}

// Judge one candidate card. Returns { tier, backCorrect, closestReference, reason, model, usage }.
async function judgeCard(judgeConfig, { sourceText, prefix, candidate, carding, readerNote, title = "", maskCandidate = true }) {
  const references = buildReferences(carding, candidate, { maskCandidate });
  const prompt = buildJudgePrompt({ sourceText, prefix, candidate, references, readerNote, title });
  const reply = judgeConfig.provider === "anthropic"
    ? await anthropicJson(judgeConfig, { system: JUDGE_SYSTEM, prompt, schema: JUDGE_SCHEMA, effort: judgeConfig.effort || "medium" })
    : await openAiJson(judgeConfig, { system: JUDGE_SYSTEM, prompt, schema: JUDGE_SCHEMA });
  const value = reply.value || {};
  return {
    tier: ["T3", "T2", "T1", "T0"].includes(value.tier) ? value.tier : "",
    backCorrect: typeof value.back_correct === "boolean" ? value.back_correct : null,
    closestReference: squash(value.closest_reference),
    reason: squash(value.reason),
    model: reply.model,
    usage: reply.usage,
    raw: reply.value ? "" : reply.text,
  };
}

module.exports = { JUDGE_SYSTEM, JUDGE_SCHEMA, buildReferences, buildJudgePrompt, judgeCard, describeCard };
