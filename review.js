// review.js — Ghostwriter for Anki Review Queue

const SAVED_KEY = "ghostwriter_saved_items";
const TRIAGE_KEY = "quickflash_triage_v1";
const OUTBOX_KEY = "quickflash_outbox_v1";

const state = {
  items: [],       // merged saved + outbox items
  index: 0,
  accepted: [],    // items ready to send
  decks: [],
  undoStack: [],
};

const REVIEW_UNDO_LIMIT = 25;
let persistQueue = Promise.resolve();

const $ = (sel) => document.querySelector(sel);

// --- DOM refs ---
const headerMeta = $("#headerMeta");
const emptyState = $("#emptyState");
const container = $("#reviewContainer");
const actionsBar = $("#actionsBar");
const navGroup = $(".nav-group");
const sendGroup = $(".send-group");
const shortcutsHint = $("#shortcutsHint");
const statusBar = $("#statusBar");
const statusPill = $("#statusPill");

const sourceText = $("#sourceText");
const sourceTitle = $("#sourceTitle");
const sourceUrl = $("#sourceUrl");
const sourceCaptured = $("#sourceCaptured");
const draftOrigin = $("#draftOrigin");

const cardFront = $("#cardFront");
const cardBack = $("#cardBack");
const cardContext = $("#cardContext");
const cardTags = $("#cardTags");
const cardDeck = $("#cardDeck");
const sendCount = $("#sendCount");

const btnPrev = $("#btnPrev");
const btnNext = $("#btnNext");
const btnAccept = $("#btnAccept");
const btnSkip = $("#btnSkip");
const btnDelete = $("#btnDelete");
const btnSend = $("#btnSend");
const btnUndo = $("#btnUndo");

function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function cloneReviewItem(item) {
  if (!item) return null;
  if (typeof structuredClone === "function") return structuredClone(item);
  return JSON.parse(JSON.stringify(item));
}

function clampIndex(index, length) {
  return Math.max(0, Math.min(Number(index) || 0, Math.max(0, length)));
}

function normalizeReviewStatus(item) {
  const status = item?.review_status || item?._status || "pending";
  return ["pending", "accepted", "skipped", "deleted", "sent"].includes(status) ? status : "pending";
}

function setReviewStatus(item, status) {
  if (!item) return item;
  const normalized = ["pending", "accepted", "skipped", "deleted", "sent"].includes(status) ? status : "pending";
  item.review_status = normalized;
  item._status = normalized;
  return item;
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  return String(value || "");
}

function toReviewItem(raw, source) {
  const item = { ...(raw || {}) };
  const status = normalizeReviewStatus(item);
  item.id = item.id || crypto.randomUUID();
  item.highlight = item.source_highlight || item.source_excerpt || item.highlight || item.source || "";
  item.pageTitle = item.source_title || item.pageTitle || item.source_label || item.sourceLabel || "";
  item.pageUrl = item.source_url || item.pageUrl || item.sourceUrl || "";
  item.textFragmentUrl = item.source_text_fragment_url || item.sourceUrl || "";
  item.capturedAt = item.captured_at || item.capturedAt || "";
  item.front = item.front || "";
  item.back = item.back || "";
  item.context = Array.isArray(item.context) ? item.context.join(" | ") : (item.context || "");
  item.tags = normalizeTags(item.tags);
  item.deck = item.deck || "";
  item.modelName = item.model || item.modelName || "";
  item.draft_origin = item.draft_origin || (item.ai_suggestion_count ? "ai_assisted" : "user_written");
  item.ai_suggestion_count = Number(item.ai_suggestion_count) || 0;
  item.created_note_ids = Array.isArray(item.created_note_ids) ? item.created_note_ids : [];
  item._source = source;
  setReviewStatus(item, status);
  return item;
}

function fromReviewItem(item) {
  const tags = normalizeTags(item.tags).split(/\s+/).filter(Boolean);
  const out = {
    ...item,
    tags,
    source_highlight: item.highlight || item.source_highlight || "",
    source_title: item.pageTitle || item.source_title || "",
    source_url: item.pageUrl || item.source_url || "",
    source_text_fragment_url: item.textFragmentUrl || item.source_text_fragment_url || "",
    captured_at: item.capturedAt || item.captured_at || new Date().toISOString(),
    model: item.modelName || item.model || "",
    review_status: normalizeReviewStatus(item),
    created_note_ids: Array.isArray(item.created_note_ids) ? item.created_note_ids : [],
  };
  delete out._source;
  delete out._status;
  delete out.highlight;
  delete out.pageTitle;
  delete out.pageUrl;
  delete out.textFragmentUrl;
  delete out.capturedAt;
  delete out.modelName;
  return out;
}

// --- Anki helpers ---
async function ankiRequest(action, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "quickflash:anki", action, params }, (res) => {
      if (res?.ok) resolve(res.result);
      else reject(new Error(res?.error || "AnkiConnect error"));
    });
  });
}

async function loadDecks() {
  try {
    const names = await ankiRequest("deckNames");
    state.decks = names || [];
    cardDeck.innerHTML = "";
    for (const name of state.decks) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      cardDeck.appendChild(opt);
    }
  } catch {
    const opt = document.createElement("option");
    opt.value = "Default";
    opt.textContent = "Default (Anki not connected)";
    cardDeck.appendChild(opt);
  }
}

async function loadModels() {
  try {
    const names = await ankiRequest("modelNames");
    state.models = names || [];
  } catch {
    state.models = ["Basic"];
  }
}

function getBestModel(item) {
  // Prefer Ghostwriter note types, then item's original model, then Basic
  const gwModels = (state.models || []).filter((m) => /ghostwriter/i.test(m));
  if (gwModels.length) return gwModels[0];
  if (item.modelName && state.models?.includes(item.modelName)) return item.modelName;
  return state.models?.[0] || "Basic";
}

// --- Load items ---
async function loadItems() {
  const got = await chrome.storage.local.get([SAVED_KEY, TRIAGE_KEY, OUTBOX_KEY]);
  const saved = (got?.[SAVED_KEY] || []).map((item) => ({
    ...toReviewItem(item, "saved"),
    back: item.back || "",
  }));

  const triageRaw = got?.[TRIAGE_KEY] || {};
  const triageAccepted = new Set(Array.isArray(triageRaw.acceptedIds) ? triageRaw.acceptedIds : []);
  const triageSkipped = new Set(Array.isArray(triageRaw.skippedIds) ? triageRaw.skippedIds : []);
  const triage = (Array.isArray(triageRaw.cards) ? triageRaw.cards : []).map((card) => {
    const item = toReviewItem(card, "triage");
    if (triageAccepted.has(item.id)) setReviewStatus(item, "accepted");
    else if (triageSkipped.has(item.id)) setReviewStatus(item, "skipped");
    return item;
  });

  const outboxRaw = got?.[OUTBOX_KEY];
  const outboxCards = Array.isArray(outboxRaw) ? outboxRaw : (outboxRaw?.cards || []);
  const outbox = outboxCards.map((card) => {
    const item = toReviewItem(card, "outbox");
    if (normalizeReviewStatus(item) === "pending") setReviewStatus(item, "accepted");
    return item;
  });

  const byId = new Map();
  for (const item of [...saved, ...triage, ...outbox]) {
    if (normalizeReviewStatus(item) === "deleted" || normalizeReviewStatus(item) === "sent") continue;
    const existing = byId.get(item.id);
    if (!existing || existing._source !== "outbox") byId.set(item.id, item);
  }
  state.items = Array.from(byId.values());
  state.index = 0;
  state.accepted = state.items.filter((item) => normalizeReviewStatus(item) === "accepted");
}

function setActionsEmptyMode(enabled) {
  if (!actionsBar) return;
  if (enabled) actionsBar.dataset.mode = "undo-only";
  else delete actionsBar.dataset.mode;
  if (navGroup) navGroup.hidden = enabled;
  if (sendGroup) sendGroup.hidden = enabled;
}

function updateUndoButton() {
  if (!btnUndo) return;
  btnUndo.disabled = state.undoStack.length === 0;
}

function pushUndo(action) {
  if (!action?.item) return;
  state.undoStack.push({
    ...action,
    item: cloneReviewItem(action.item),
  });
  if (state.undoStack.length > REVIEW_UNDO_LIMIT) {
    state.undoStack.splice(0, state.undoStack.length - REVIEW_UNDO_LIMIT);
  }
  updateUndoButton();
}

function describeUndoAction(type) {
  if (type === "accept") return "accept";
  if (type === "reject") return "reject";
  return "delete";
}

function queuePersistItems() {
  persistQueue = persistQueue
    .catch(() => {})
    .then(() => persistItems())
    .catch((err) => {
      console.warn("Failed to persist review queue", err);
      showStatus("Could not save the review queue. Try again.");
    });
  return persistQueue;
}

// --- Render ---
function render() {
  const total = state.items.length;
  const accepted = state.items.filter((i) => normalizeReviewStatus(i) === "accepted").length;

  headerMeta.textContent = total > 0
    ? `Card ${state.index + 1} of ${total} · ${accepted} accepted`
    : "No cards";

  if (total === 0) {
    emptyState.hidden = false;
    container.hidden = true;
    actionsBar.hidden = state.undoStack.length === 0;
    shortcutsHint.hidden = true;
    setActionsEmptyMode(state.undoStack.length > 0);
    updateUndoButton();
    return;
  }

  emptyState.hidden = true;
  container.hidden = false;
  actionsBar.hidden = false;
  shortcutsHint.hidden = false;
  setActionsEmptyMode(false);
  updateUndoButton();

  const item = state.items[state.index];
  if (!item) return;
  const status = normalizeReviewStatus(item);

  // Source panel
  sourceText.textContent = item.highlight || "No source captured.";
  sourceTitle.textContent = item.pageTitle || "";
  const linkUrl = item.textFragmentUrl || item.pageUrl;
  if (linkUrl) {
    try {
      sourceUrl.textContent = new URL(linkUrl).hostname;
    } catch {
      sourceUrl.textContent = linkUrl;
    }
    sourceUrl.href = linkUrl;
    sourceUrl.hidden = false;
  } else {
    sourceUrl.hidden = true;
  }
  if (item.capturedAt) {
    const d = new Date(item.capturedAt);
    const ago = timeAgo(d);
    sourceCaptured.textContent = `Captured ${ago}`;
  } else {
    sourceCaptured.textContent = "";
  }

  // Draft origin
  const originLabel = {
    highlight_triggered: "Highlight-triggered draft",
    ai_assisted: "AI-assisted draft",
    user_written: "User-written draft",
  }[item.draft_origin] || "Card draft";
  const aiBit = item.ai_suggestion_count ? ` · ${item.ai_suggestion_count} AI suggestion${item.ai_suggestion_count === 1 ? "" : "s"}` : "";
  draftOrigin.textContent = `${originLabel}${aiBit}`;
  if (statusPill) {
    statusPill.textContent = status === "skipped" ? "Rejected" : titleCase(status);
    statusPill.dataset.status = status;
  }

  // Card fields
  cardFront.value = item.front || "";
  cardBack.value = item.back || "";
  cardContext.value = item.context || "";
  cardTags.value = item.tags || "";
  if (item.deck && cardDeck.querySelector(`option[value="${CSS.escape(item.deck)}"]`)) {
    cardDeck.value = item.deck;
  } else if (cardDeck.options.length) {
    cardDeck.value = cardDeck.options[0].value;
  }

  // Accepted indicator
  if (status === "accepted") {
    btnAccept.textContent = "Accepted";
    btnAccept.disabled = true;
  } else {
    btnAccept.textContent = "Accept";
    btnAccept.disabled = false;
  }

  // Nav buttons
  btnPrev.disabled = state.index === 0;
  btnNext.disabled = state.index >= total - 1;

  // Send count
  const readyCount = state.items.filter((i) => normalizeReviewStatus(i) === "accepted").length;
  sendCount.textContent = readyCount > 0 ? `${readyCount} ready` : "";
  btnSend.disabled = readyCount === 0;
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// --- Actions ---
function saveCurrentFields() {
  const item = state.items[state.index];
  if (!item) return;
  item.front = cardFront.value;
  item.back = cardBack.value;
  item.context = cardContext.value;
  item.tags = cardTags.value;
  item.deck = cardDeck.value;
}

function acceptCurrent() {
  saveCurrentFields();
  const item = state.items[state.index];
  if (!item || normalizeReviewStatus(item) === "accepted") return;
  pushUndo({
    type: "accept",
    item,
    index: state.index,
  });
  setReviewStatus(item, "accepted");
  item._source = "outbox";
  queuePersistItems();
  advanceToNext();
  showStatus("Accepted card. Undo is available.");
}

function rejectCurrent() {
  removeCurrent({ type: "reject" });
}

function removeCurrent({ type = "delete" } = {}) {
  saveCurrentFields();
  const item = state.items[state.index];
  if (!item) return;
  const index = state.index;
  pushUndo({
    type,
    item,
    index,
  });
  setReviewStatus(item, "deleted");
  state.items.splice(index, 1);
  if (state.index >= state.items.length) state.index = Math.max(0, state.items.length - 1);
  queuePersistItems();
  render();
  showStatus(type === "reject" ? "Rejected card. Undo is available." : "Deleted card. Undo is available.");
}

function deleteCurrent() {
  removeCurrent({ type: "delete" });
}

function undoLastAction() {
  const action = state.undoStack.pop();
  if (!action) {
    updateUndoButton();
    showStatus("Nothing to undo.");
    return;
  }

  const restored = cloneReviewItem(action.item);
  if (!restored) {
    updateUndoButton();
    showStatus("Could not restore the previous action.");
    return;
  }

  const existingIndex = state.items.findIndex((item) => item.id === restored.id);
  if (existingIndex !== -1) state.items.splice(existingIndex, 1);

  const insertIndex = clampIndex(action.index, state.items.length);
  state.items.splice(insertIndex, 0, restored);
  state.index = insertIndex;
  queuePersistItems();
  render();
  showStatus(`Undid ${describeUndoAction(action.type)}.`);
}

function advanceToNext() {
  // Find next pending/skipped item
  for (let i = state.index + 1; i < state.items.length; i++) {
    if (["pending", "skipped"].includes(normalizeReviewStatus(state.items[i]))) {
      state.index = i;
      render();
      return;
    }
  }
  // Wrap around
  for (let i = 0; i < state.index; i++) {
    if (["pending", "skipped"].includes(normalizeReviewStatus(state.items[i]))) {
      state.index = i;
      render();
      return;
    }
  }
  // All done — stay on current
  render();
}

function goToPrev() {
  if (state.index > 0) {
    saveCurrentFields();
    state.index--;
    render();
  }
}

function goToNext() {
  if (state.index < state.items.length - 1) {
    saveCurrentFields();
    state.index++;
    render();
  }
}

async function sendToAnki() {
  const accepted = state.items.filter((i) => normalizeReviewStatus(i) === "accepted");
  if (!accepted.length) return;

  showStatus("Sending cards...");
  btnSend.disabled = true;

  let sent = 0;
  let failed = 0;

  for (const item of accepted) {
    try {
      const deck = item.deck || cardDeck.value || "Default";
      const modelName = getBestModel(item);
      const fields = {
        Front: item.front || "",
        Back: item.back || "",
      };
      if (item.context) fields.Context = item.context;
      if (item.highlight) fields.Source = item.highlight;

      const tags = (item.tags || "").split(/\s+/).filter(Boolean);

      const noteId = await ankiRequest("addNote", {
        note: {
          deckName: deck,
          modelName,
          fields,
          tags,
          options: { allowDuplicate: false },
        },
      });
      setReviewStatus(item, "sent");
      item.created_note_ids = [
        ...(Array.isArray(item.created_note_ids) ? item.created_note_ids : []),
        noteId,
      ].filter(Boolean);
      sent++;
    } catch (err) {
      console.warn("Failed to send card:", err);
      failed++;
    }
  }

  // Remove sent items
  state.items = state.items.filter((i) => normalizeReviewStatus(i) !== "sent");
  if (state.index >= state.items.length) state.index = Math.max(0, state.items.length - 1);

  queuePersistItems();
  updateBadge();
  render();

  if (failed === 0) {
    showStatus(`Sent ${sent} card${sent === 1 ? "" : "s"} to Anki.`);
  } else {
    showStatus(`Sent ${sent}, failed ${failed}. Check that Anki is running.`);
  }
}

async function persistItems() {
  const saved = state.items
    .filter((i) => i._source === "saved")
    .map(fromReviewItem);
  const triageCards = state.items
    .filter((i) => ["pending", "skipped"].includes(normalizeReviewStatus(i)))
    .map(fromReviewItem);
  const outbox = state.items
    .filter((i) => normalizeReviewStatus(i) === "accepted")
    .map(fromReviewItem);

  // Preserve existing lastSend data so panel.js undo still works
  const existing = await chrome.storage.local.get(OUTBOX_KEY);
  const existingOutbox = existing?.[OUTBOX_KEY] || {};
  const lastSend = existingOutbox.lastSend || { noteIds: [], cards: [] };

  await chrome.storage.local.set({
    [SAVED_KEY]: saved,
    [TRIAGE_KEY]: {
      cards: triageCards,
      i: Math.min(state.index, Math.max(0, triageCards.length - 1)),
      acceptedIds: [],
      skippedIds: triageCards.filter((card) => card.review_status === "skipped").map((card) => card.id),
      deck: "",
      fingerprints: [],
    },
    [OUTBOX_KEY]: { cards: outbox, lastSend },
  });
}

function updateBadge() {
  const count = state.items.filter((i) => i._source === "saved" && i._status !== "sent").length;
  chrome.runtime.sendMessage({ type: "ghostwriter:updateBadge", count });
}

function showStatus(msg) {
  statusBar.textContent = msg;
  statusBar.classList.add("visible");
  setTimeout(() => { statusBar.classList.remove("visible"); }, 4000);
}

// --- Keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  // Don't intercept when typing in fields
  const tag = e.target.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
  const key = (e.key || "").toLowerCase();
  const isUndoShortcut = key === "z" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  if (isUndoShortcut || (key === "u" && !e.metaKey && !e.ctrlKey && !e.altKey)) {
    e.preventDefault();
    undoLastAction();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case "a": case "A":
      e.preventDefault();
      acceptCurrent();
      break;
    case "r": case "R":
    case "s": case "S":
      e.preventDefault();
      rejectCurrent();
      break;
    case "d": case "D":
      e.preventDefault();
      deleteCurrent();
      break;
    case "e": case "E":
      e.preventDefault();
      cardFront.focus();
      break;
    case "ArrowLeft":
      e.preventDefault();
      goToPrev();
      break;
    case "ArrowRight":
      e.preventDefault();
      goToNext();
      break;
    case "Enter":
      e.preventDefault();
      sendToAnki();
      break;
  }
});

// --- Button listeners ---
btnPrev.addEventListener("click", goToPrev);
btnNext.addEventListener("click", goToNext);
btnAccept.addEventListener("click", acceptCurrent);
btnSkip.addEventListener("click", rejectCurrent);
btnDelete.addEventListener("click", deleteCurrent);
btnSend.addEventListener("click", sendToAnki);
btnUndo.addEventListener("click", undoLastAction);

// Save fields when navigating away
cardFront.addEventListener("blur", saveCurrentFields);
cardBack.addEventListener("blur", saveCurrentFields);
cardContext.addEventListener("blur", saveCurrentFields);
cardTags.addEventListener("blur", saveCurrentFields);
cardDeck.addEventListener("change", saveCurrentFields);

// --- Init ---
(async () => {
  await loadDecks();
  await loadModels();
  await loadItems();
  render();
})();
