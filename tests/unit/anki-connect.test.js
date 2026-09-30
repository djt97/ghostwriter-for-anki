const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../anki-connect.js");

const json = (body, status = 200) => ({ status, json: async () => body });

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

test("an AnkiConnect refusal is reported once and never retried on the other host", async () => {
  const f = fakeFetch([json({ result: null, error: "cannot create note because it is a duplicate" })]);
  await assert.rejects(
    A.request("addNote", { note: {} }, { baseUrl: "http://127.0.0.1:8765", fetchImpl: f.impl }),
    (err) => err.kind === "anki" && /already has a card/.test(err.message) && !/Android/.test(err.message),
  );
  assert.equal(f.calls.length, 1);
});

test("a network failure on 127.0.0.1 falls back to localhost", async () => {
  const f = fakeFetch([new TypeError("Failed to fetch"), json({ result: 6, error: null })]);
  const result = await A.request("version", {}, { baseUrl: "http://127.0.0.1:8765", fetchImpl: f.impl });
  assert.equal(result, 6);
  assert.deepEqual(f.calls.map((c) => c.url), ["http://127.0.0.1:8765", "http://localhost:8765"]);
  assert.equal(f.calls[0].body.version, 6);
});

test("when nothing answers on this computer the message is about desktop Anki, not Android", async () => {
  const f = fakeFetch([new TypeError("Failed to fetch"), new TypeError("Failed to fetch")]);
  await assert.rejects(
    A.request("version", {}, { baseUrl: "http://127.0.0.1:8765", fetchImpl: f.impl }),
    (err) => err.kind === "unreachable" && /Open Anki/.test(err.message) && !/Android/.test(err.message),
  );
});

test("on Android the hint is about AnkiconnectAndroid even for localhost", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Linux; Android 14)" }, configurable: true });
  try {
    const f = fakeFetch([new TypeError("x"), new TypeError("x")]);
    await assert.rejects(
      A.request("version", {}, { baseUrl: "http://localhost:8765", fetchImpl: f.impl }),
      (err) => /AnkiconnectAndroid/.test(err.message),
    );
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved); else delete globalThis.navigator;
  }
});

test("a non-local AnkiConnect address gets the Android hint", async () => {
  const f = fakeFetch([new TypeError("Failed to fetch")]);
  await assert.rejects(
    A.request("version", {}, { baseUrl: "http://192.168.1.20:8765", fetchImpl: f.impl }),
    (err) => err.kind === "unreachable" && /AnkiconnectAndroid/.test(err.message),
  );
  assert.equal(f.calls.length, 1);
});

test("a timeout is not retried on the other host", async () => {
  const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
  const f = fakeFetch([timeout, json({ result: 1, error: null })]);
  await assert.rejects(
    A.request("addNote", {}, { baseUrl: "http://127.0.0.1:8765", fetchImpl: f.impl }),
    (err) => err.kind === "timeout",
  );
  assert.equal(f.calls.length, 1);
});

test("a server that isn't AnkiConnect counts as unreachable and is not retried elsewhere", async () => {
  const f = fakeFetch([{ status: 404, json: async () => { throw new Error("not json"); } }, json({ result: 1, error: null })]);
  await assert.rejects(
    A.request("addNote", {}, { fetchImpl: f.impl }),
    (err) => err.kind === "unreachable" && /HTTP 404/.test(err.message),
  );
  assert.equal(f.calls.length, 1);
});

test("a timeout while reading the reply is not retried (the note may already be added)", async () => {
  const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
  const f = fakeFetch([{ status: 200, json: async () => { throw timeout; } }, json({ result: 1, error: null })]);
  await assert.rejects(
    A.request("addNote", {}, { baseUrl: "http://127.0.0.1:8765", fetchImpl: f.impl }),
    (err) => err.kind === "timeout",
  );
  assert.equal(f.calls.length, 1);
});

test("HTTP 403 says Anki refused the connection", async () => {
  const f = fakeFetch([{ status: 403, json: async () => { throw new Error("not json"); } }]);
  await assert.rejects(
    A.request("version", {}, { fetchImpl: f.impl }),
    (err) => err.kind === "refused" && /refused the connection \(HTTP 403\)/.test(err.message),
  );
});

test("candidate URLs swap loopback names and keep the port", () => {
  assert.deepEqual(A.candidateUrls("http://localhost:9999/"), ["http://localhost:9999", "http://127.0.0.1:9999"]);
  assert.deepEqual(A.candidateUrls(""), ["http://127.0.0.1:8765", "http://localhost:8765"]);
  assert.deepEqual(A.candidateUrls("http://10.0.0.5:8765"), ["http://10.0.0.5:8765"]);
});
