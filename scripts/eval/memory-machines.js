// The Memory Machines prompts (Kirkby & Matuschak, 2026): laddermedia/srs-prompts on Hugging
// Face, Apache-2.0. Each row is a Q/A prompt written for a reading highlight and rated by people:
// T3 ready to review, T2 needs polish, T1 needs refactor, T0 off-target. Rows are fetched at run
// time and never stored in the repository, because the highlights quote third-party text.

const DATASET = "laddermedia/srs-prompts";
const EXPECTED_SHA = "ed4fdd2e2dd9f3a5ea27d008b22e6b60203d9714";
const TIERS = { "off-target": "T0", "needs-refactor": "T1", "needs-polish": "T2", "ready-to-review": "T3" };
const TAG_TEXT = {
  ambiguous_lacks_context: "lacks the context needed to know what is asked",
  ambiguous_solicits_multiple_responses: "admits several answers",
  narrow: "too narrow",
  shallow: "shallow",
  wordy: "wordy",
};

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchRows(split) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = await getJson(`https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}&config=default&split=${split}&offset=${offset}&length=100`);
    rows.push(...(page.rows || []).map((r) => r.row));
    if (!page.rows || page.rows.length < 100) break;
  }
  return rows;
}

async function fetchRevision() {
  return (await getJson(`https://huggingface.co/api/datasets/${DATASET}`)).sha;
}

// "Q. ...\nA. ..." -> { front, back }
function splitPrompt(content) {
  const text = String(content || "");
  const q = text.match(/(?:^|\n)\s*Q\.\s*([\s\S]*?)(?=\n\s*A\.|$)/);
  const a = text.match(/(?:^|\n)\s*A\.\s*([\s\S]*)$/);
  return { front: (q?.[1] || "").trim(), back: (a?.[1] || "").trim() };
}

// Some prompts open with their source in brackets ("[Magic Ink] What...") or parentheses
// ("(Meister, 2024) Why..."). The tag stays on the reference card, where it gives context, but
// not in what the reader is taken to have typed.
const stripSourceTag = (front) => String(front || "").replace(/^\s*(?:\[[^\]]*\]|\([^)]*\d{4}[^)]*\))\s*/, "");

const STOP = new Set(("the a an of in on at to for by with and or is are was were be been it its that this as from into than "
  + "their they them which what who how why when where does do did can could not no but so if then there these those has have had").split(" "));
// Crude, but singular and plural meet: message/messages, process/processes, study/studies.
const stem = (w) => w.replace(/ies$/, "y").replace(/(?:ing|ed|ly)$/, "").replace(/([^s])s$/, "$1").replace(/e$/, "");
const contentStems = (text) => (String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w)).map(stem);

// Share of the answer's content words that appear in the highlight. A card whose answer comes from
// elsewhere in the article can't be written from the highlight alone, and Ghostwriter only sees
// what the reader selected.
function groundedShare(back, highlight) {
  const answer = contentStems(back);
  if (!answer.length) return 0;
  const source = new Set(contentStems(highlight));
  return answer.filter((w) => source.has(w)).length / answer.length;
}

// What the reader is taken to have typed: the first three words of the card (two for a short
// one), extended to the first content word so the prefix says what it asks about ("What is the
// smallest", not "What is the"). The prefix is the start of the rated card, so it can't give away
// more than the card does.
function prefixFromFront(front) {
  const words = stripSourceTag(front).trim().split(/\s+/).filter(Boolean);
  const isContent = (word) => contentStems(word).length > 0;
  let n = Math.min(words.length - 1, words.length <= 5 ? 2 : 3);
  while (n < Math.min(words.length - 1, 6) && !words.slice(0, n).some(isContent)) n += 1;
  return words.slice(0, Math.max(1, n)).join(" ");
}

function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text || "")) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

// A stable two-way split by source article, so a later prompt change can be tuned on one part
// and measured on the other without the same article appearing in both. Articles are taken in
// hash order into the holdout until it holds about a third of the cases.
function assignPartitions(cases) {
  const bySource = new Map();
  for (const c of cases) bySource.set(c.pageUrl, (bySource.get(c.pageUrl) || 0) + 1);
  const holdout = new Set();
  let held = 0;
  for (const [url, count] of [...bySource.entries()].sort((a, b) => hash(a[0]) - hash(b[0]))) {
    if (held >= cases.length / 3) break;
    holdout.add(url);
    held += count;
  }
  for (const c of cases) c.tags.push(holdout.has(c.pageUrl) ? "holdout" : "dev");
  return cases;
}

function reason(tier, tags) {
  const words = (tags || []).filter((t) => t !== "off-target").map((t) => TAG_TEXT[t] || t.replace(/_/g, " "));
  const label = { T2: "Needs polish", T1: "Needs refactor", T0: "Off-target" }[tier];
  return words.length ? `${label}: ${words.join("; ")}` : label;
}

// Rows -> eval cases, one per highlight that has a ready (T3) prompt answerable from the passage
// the model is shown. visiblePassage(highlight, prefix) returns that passage; the builder passes
// the extension's own narrowing.
function buildCases(rows, { split = "", visiblePassage = (highlight) => highlight } = {}) {
  const byHighlight = new Map();
  for (const row of rows) {
    if (!byHighlight.has(row.highlight_id)) byHighlight.set(row.highlight_id, []);
    byHighlight.get(row.highlight_id).push(row);
  }
  const cases = [];
  const skipped = { noReadyPrompt: 0, notGrounded: 0 };
  for (const [highlightId, list] of [...byHighlight.entries()].sort((a, b) => a[0] - b[0])) {
    const highlight = String(list[0].highlight || "").replace(/\s+/g, " ").trim();
    const cards = list.slice().sort((a, b) => a.id - b.id).map((row) => {
      const { front, back } = splitPrompt(row.content);
      return { type: "basic", front, back, tier: TIERS[row.task_type] || "", tags: row.tags || [], promptId: row.id };
    }).filter((card) => card.front && card.back && card.tier);
    const ready = cards.filter((card) => card.tier === "T3");
    if (!ready.length) { skipped.noReadyPrompt += 1; continue; }
    // A short answer needs all of its words in the passage; a longer one, at least half.
    const answerable = (card) => {
      const share = groundedShare(card.back, visiblePassage(highlight, prefixFromFront(card.front)));
      return contentStems(card.back).length <= 2 ? share === 1 : share >= 0.5;
    };
    const target = ready.find(answerable);
    if (!target) { skipped.notGrounded += 1; continue; }
    const plain = ({ type, front, back, tier, promptId }) => ({ type, front, back, tier, promptId });
    const prefix = prefixFromFront(target.front);
    const meta = list[0].source_meta || {};
    cases.push({
      id: `mm-${highlightId}`,
      section: meta.title || "",
      tags: ["memory-machines", split ? `mm-${split}` : ""].filter(Boolean),
      pageTitle: meta.title || "",
      pageUrl: list[0].source_url || "",
      sourceText: highlight,
      frontPrefix: prefix,
      carding: {
        verdict: "basic",
        rationale: "Memory Machines highlight with prompts rated by people (Kirkby & Matuschak, 2026).",
        plausibleUserPrefixes: [prefix],
        preferredCards: [target, ...ready.filter((card) => card !== target)].map(plain),
        alternateCards: cards.filter((card) => card.tier === "T2").map((card) => ({ ...plain(card), rationale: reason("T2", card.tags) })),
        badButPlausibleCards: cards.filter((card) => card.tier === "T1" || card.tier === "T0").map((card) => ({ ...plain(card), whyBad: reason(card.tier, card.tags) })),
      },
    });
  }
  return { cases, skipped };
}

module.exports = {
  DATASET, EXPECTED_SHA, TIERS, fetchRows, fetchRevision, splitPrompt, stripSourceTag,
  groundedShare, prefixFromFront, assignPartitions, buildCases,
};
