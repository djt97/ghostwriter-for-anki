/* global module, AbortSignal */
// anki-connect.js — AnkiConnect requests shared by the panel and the service worker.
//
// Errors carry a `kind`:
//   "anki"        AnkiConnect answered and refused the request (duplicate, missing deck, ...)
//   "unreachable" nothing answered at any candidate address, or something that isn't AnkiConnect did
//   "refused"     AnkiConnect answered 401/403: this extension's origin isn't allowed yet
//   "timeout"     the request was sent but Anki did not answer in time
// Only a failed connection is retried on the other loopback name; once anything answers, the
// request may have reached Anki, and retrying could add a card twice.
// Error messages are written for the user; the raw AnkiConnect text is kept on `raw`.
(function (root) {
  const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
  const DEFAULT_TIMEOUT_MS = 15000;
  const SLOW_ACTION_TIMEOUT_MS = 60000;
  const SLOW_ACTIONS = new Set(["storeMediaFile", "addNotes", "createModel", "updateModelTemplates"]);
  const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || "").trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
  }

  function candidateUrls(baseUrl) {
    const configured = normalizeBaseUrl(baseUrl);
    const out = [configured];
    try {
      const u = new URL(configured);
      const swap = u.hostname === "127.0.0.1" ? "localhost" : (u.hostname === "localhost" ? "127.0.0.1" : "");
      if (swap) {
        u.hostname = swap;
        out.push(u.toString().replace(/\/+$/, ""));
      }
    } catch {}
    return out;
  }

  function isLocalAnkiUrl(baseUrl) {
    try {
      return LOCAL_HOSTS.has(new URL(normalizeBaseUrl(baseUrl)).hostname);
    } catch {
      return true;
    }
  }

  function describeAnkiRefusal(raw) {
    const text = String(raw || "").trim();
    if (/duplicate/i.test(text)) return "Anki already has a card with this Front in that deck.";
    if (/note is empty|because it is empty/i.test(text)) {
      return "Anki says the note's first field is empty. Check that the note type's fields match this card.";
    }
    if (/deck was not found/i.test(text)) return "Anki couldn't find that deck. Pick another deck and try again.";
    if (/model was not found/i.test(text)) return "Anki couldn't find that note type. Pick another note type and try again.";
    return `Anki says: ${text || "unknown error"}`;
  }

  const ANDROID_HINT = 'On Android, open AnkiconnectAndroid, tap "Start Service", and set "CORS host" to the extension origin shown in Options.';

  function isAndroid() {
    return /Android/i.test(String(root.navigator?.userAgent || ""));
  }

  function unreachableMessage(baseUrl) {
    if (isAndroid() || !isLocalAnkiUrl(baseUrl)) {
      return `Can't reach AnkiConnect at ${normalizeBaseUrl(baseUrl)}. ${ANDROID_HINT}`;
    }
    return "Can't reach Anki. Open Anki on this computer and check that the AnkiConnect add-on (code 2055492159) is installed.";
  }

  function refusedMessage(status) {
    const android = isAndroid() ? ` ${ANDROID_HINT}` : "";
    return `Anki refused the connection (HTTP ${status}). In Anki, allow Ghostwriter when AnkiConnect asks, or add this extension to AnkiConnect's webCorsOriginList.${android}`;
  }

  function timeoutError(err, tried) {
    return makeError("Anki didn't respond in time. If Anki is showing a dialog, close it and try again.", {
      kind: "timeout", raw: err?.message || "", tried,
    });
  }

  function makeError(message, fields) {
    return Object.assign(new Error(message), { name: "AnkiConnectError" }, fields);
  }

  function timeoutFor(action, timeoutMs) {
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;
    return SLOW_ACTIONS.has(action) ? SLOW_ACTION_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  }

  function isTimeout(err) {
    return err?.name === "TimeoutError" || err?.name === "AbortError";
  }

  async function request(action, params = {}, { baseUrl, fetchImpl, timeoutMs } = {}) {
    const doFetch = fetchImpl || root.fetch.bind(root);
    const body = JSON.stringify({ action, version: 6, params: params || {} });
    const limit = timeoutFor(action, timeoutMs);
    const tried = [];
    let lastDetail = "";

    for (const url of candidateUrls(baseUrl)) {
      tried.push(url);
      let res;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(limit),
        });
      } catch (err) {
        // The request may have reached Anki; retrying elsewhere could add the card twice.
        if (isTimeout(err)) throw timeoutError(err, tried);
        lastDetail = err?.message || String(err);
        continue; // nothing answered here: try the other loopback name
      }

      // Something answered. From here on, never retry on another address.
      // An HTTP refusal takes precedence over any JSON reply body.
      if (res.status === 401 || res.status === 403) {
        throw makeError(refusedMessage(res.status), { kind: "refused", raw: `HTTP ${res.status}`, tried });
      }
      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        if (isTimeout(err)) throw timeoutError(err, tried);
      }
      if (data && typeof data === "object" && "error" in data) {
        if (data.error) {
          throw makeError(describeAnkiRefusal(data.error), { kind: "anki", raw: String(data.error), tried });
        }
        return data.result;
      }
      throw makeError(`${unreachableMessage(baseUrl)} (Something else answered at ${url}: HTTP ${res.status}.)`, {
        kind: "unreachable", raw: `HTTP ${res.status} (not an AnkiConnect response)`, tried,
      });
    }

    throw makeError(unreachableMessage(baseUrl), { kind: "unreachable", raw: lastDetail, tried });
  }

  const api = { request, candidateUrls, isLocalAnkiUrl, describeAnkiRefusal, DEFAULT_BASE_URL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GHOSTWRITER_ANKI = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
