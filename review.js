// review.js — Ghostwriter for Anki Review Queue

const SAVED_KEY = "ghostwriter_saved_items";
const OUTBOX_KEY = "quickflash_outbox_v1";

const state = {
  items: [],       // merged saved + outbox items
  index: 0,
  accepted: [],    // items ready to send
  decks: [],
};

const $ = (sel) => document.querySelector(sel);

// --- DOM refs ---
const headerMeta = $("#headerMeta");
const emptyState = $("#emptyState");
const container = $("#reviewContainer");
const actionsBar = $("#actionsBar");
const shortcutsHint = $("#shortcutsHint");
const statusBar = $("#statusBar");

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

// --- Load items ---
async function loadItems() {
  const got = await chrome.storage.local.get([SAVED_KEY, OUTBOX_KEY]);
  const saved = (got?.[SAVED_KEY] || []).map((item) => ({
    ...item,
    _source: "saved",
    front: item.front || "",
    back: item.back || item.highlight || "",
    context: item.context || "",
    tags: item.tags || "",
    deck: item.deck || "",
    _status: item._status || "pending",
  }));

  const outboxRaw = got?.[OUTBOX_KEY];
  const outboxCards = Array.isArray(outboxRaw) ? outboxRaw : (outboxRaw?.cards || []);
  const outbox = outboxCards.map((card) => ({
    id: card.id || crypto.randomUUID(),
    highlight: card.source || card.back || "",
    pageTitle: card.sourceLabel || "",
    pageUrl: card.sourceUrl || "",
    capturedAt: card.capturedAt || "",
    front: card.front || "",
    back: card.back || "",
    context: card.context || "",
    tags: card.tags || "",
    deck: card.deck || "",
    _source: "outbox",
    _status: card._status || "pending",
  }));

  state.items = [...saved, ...outbox].filter((item) => item._status !== "deleted");
  state.index = 0;
  state.accepted = state.items.filter((item) => item._status === "accepted");
}

// --- Render ---
function render() {
  const total = state.items.length;
  const pending = state.items.filter((i) => i._status === "pending" || i._status === "skipped").length;
  const accepted = state.items.filter((i) => i._status === "accepted").length;

  headerMeta.textContent = total > 0
    ? `${state.index + 1} of ${total} cards · ${accepted} accepted`
    : "No cards";

  if (total === 0) {
    emptyState.hidden = false;
    container.hidden = true;
    actionsBar.hidden = true;
    shortcutsHint.hidden = true;
    return;
  }

  emptyState.hidden = true;
  container.hidden = false;
  actionsBar.hidden = false;
  shortcutsHint.hidden = false;

  const item = state.items[state.index];
  if (!item) return;

  // Source panel
  sourceText.textContent = item.highlight || "(no highlight)";
  sourceTitle.textContent = item.pageTitle || "";
  if (item.pageUrl) {
    sourceUrl.textContent = new URL(item.pageUrl).hostname;
    sourceUrl.href = item.pageUrl;
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
  if (item._source === "saved") {
    draftOrigin.textContent = item.front ? "AI-drafted from highlight" : "Saved highlight — needs a card";
  } else {
    draftOrigin.textContent = "From card editor";
  }

  // Card fields
  cardFront.value = item.front || "";
  cardBack.value = item.back || "";
  cardContext.value = item.context || "";
  cardTags.value = item.tags || "";
  if (item.deck && cardDeck.querySelector(`option[value="${CSS.escape(item.deck)}"]`)) {
    cardDeck.value = item.deck;
  }

  // Accepted indicator
  if (item._status === "accepted") {
    btnAccept.textContent = "Accepted ✓";
    btnAccept.disabled = true;
  } else {
    btnAccept.textContent = "Accept";
    btnAccept.disabled = false;
  }

  // Nav buttons
  btnPrev.disabled = state.index === 0;
  btnNext.disabled = state.index >= total - 1;

  // Send count
  const readyCount = state.items.filter((i) => i._status === "accepted").length;
  sendCount.textContent = readyCount > 0 ? `${readyCount} card${readyCount === 1 ? "" : "s"} ready` : "";
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
  if (!item || item._status === "accepted") return;
  item._status = "accepted";
  persistItems();
  advanceToNext();
}

function skipCurrent() {
  saveCurrentFields();
  const item = state.items[state.index];
  if (!item) return;
  item._status = "skipped";
  persistItems();
  advanceToNext();
}

function deleteCurrent() {
  const item = state.items[state.index];
  if (!item) return;
  state.items.splice(state.index, 1);
  if (state.index >= state.items.length) state.index = Math.max(0, state.items.length - 1);
  persistItems();
  render();
}

function advanceToNext() {
  // Find next pending/skipped item
  for (let i = state.index + 1; i < state.items.length; i++) {
    if (state.items[i]._status === "pending" || state.items[i]._status === "skipped") {
      state.index = i;
      render();
      return;
    }
  }
  // Wrap around
  for (let i = 0; i < state.index; i++) {
    if (state.items[i]._status === "pending" || state.items[i]._status === "skipped") {
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
  const accepted = state.items.filter((i) => i._status === "accepted");
  if (!accepted.length) return;

  showStatus("Sending cards...");
  btnSend.disabled = true;

  let sent = 0;
  let failed = 0;

  for (const item of accepted) {
    try {
      const deck = item.deck || cardDeck.value || "Default";
      const fields = {
        Front: item.front || "",
        Back: item.back || "",
      };
      if (item.context) fields.Context = item.context;
      if (item.highlight) fields.Source = item.highlight;

      const tags = (item.tags || "").split(/\s+/).filter(Boolean);

      await ankiRequest("addNote", {
        note: {
          deckName: deck,
          modelName: "Basic",
          fields,
          tags,
          options: { allowDuplicate: false },
        },
      });
      item._status = "sent";
      sent++;
    } catch (err) {
      console.warn("Failed to send card:", err);
      failed++;
    }
  }

  // Remove sent items
  state.items = state.items.filter((i) => i._status !== "sent");
  if (state.index >= state.items.length) state.index = Math.max(0, state.items.length - 1);

  persistItems();
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
    .map(({ _source, ...rest }) => rest);
  const outbox = state.items
    .filter((i) => i._source === "outbox")
    .map(({ _source, ...rest }) => rest);

  await chrome.storage.local.set({
    [SAVED_KEY]: saved,
    [OUTBOX_KEY]: { cards: outbox },
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

  switch (e.key) {
    case "a": case "A":
      e.preventDefault();
      acceptCurrent();
      break;
    case "s": case "S":
      e.preventDefault();
      skipCurrent();
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
btnSkip.addEventListener("click", skipCurrent);
btnDelete.addEventListener("click", deleteCurrent);
btnSend.addEventListener("click", sendToAnki);

// Save fields when navigating away
cardFront.addEventListener("blur", saveCurrentFields);
cardBack.addEventListener("blur", saveCurrentFields);
cardContext.addEventListener("blur", saveCurrentFields);
cardTags.addEventListener("blur", saveCurrentFields);
cardDeck.addEventListener("change", saveCurrentFields);

// --- Init ---
(async () => {
  await loadDecks();
  await loadItems();
  render();
})();
