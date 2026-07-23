// Chrome Prompt API adapter. This file is document-only: the Prompt API is not
// available to extension service workers. Each request gets an isolated session
// so card content cannot leak into a later completion through model history.
(function initGhostwriterNativeAI(root) {
  "use strict";

  const TASK_KINDS = Object.freeze(["front", "back", "cloze", "tags", "context"]);
  const STRUCTURED_TASKS = new Set(["tags", "context"]);
  const AVAILABILITY_STATES = new Set(["unavailable", "downloadable", "downloading", "available"]);

  class NativeAIError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = "NativeAIError";
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }

  function getLanguageModel() {
    const candidate = root?.LanguageModel;
    return candidate && (typeof candidate === "object" || typeof candidate === "function")
      ? candidate
      : null;
  }

  function textCapabilities() {
    return {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    };
  }

  function isSupported() {
    const model = getLanguageModel();
    return !!model && typeof model.availability === "function" && typeof model.create === "function";
  }

  async function availability() {
    const model = getLanguageModel();
    if (!isSupported()) return "unsupported";
    try {
      const state = await model.availability(textCapabilities());
      return AVAILABILITY_STATES.has(state) ? state : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  function emitProgress(onProgress, status, loaded) {
    if (typeof onProgress !== "function") return;
    try {
      onProgress({ status, loaded });
    } catch {
      // UI callbacks cannot interrupt model setup or leave a session allocated.
    }
  }

  function hasActiveUserGesture() {
    if (typeof navigator === "undefined" || !navigator.userActivation) return false;
    return navigator.userActivation.isActive === true;
  }

  function setupErrorForState(state) {
    if (state === "unsupported") {
      return new NativeAIError("unsupported", "Chrome on-device AI is not supported in this browser.");
    }
    if (state === "unavailable") {
      return new NativeAIError("unavailable", "Chrome on-device AI is unavailable on this device.");
    }
    return null;
  }

  async function setup({ signal, onProgress } = {}) {
    if (!hasActiveUserGesture()) {
      throw new NativeAIError(
        "user-activation-required",
        "Set up Chrome on-device AI from a button click."
      );
    }

    const state = await availability();
    const stateError = setupErrorForState(state);
    if (stateError) throw stateError;

    const model = getLanguageModel();
    let session = null;
    emitProgress(onProgress, state === "available" ? "preparing" : "downloading", state === "available" ? 1 : 0);
    try {
      session = await model.create({
        ...textCapabilities(),
        ...(signal ? { signal } : {}),
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            const loaded = Math.max(0, Math.min(1, Number(event?.loaded) || 0));
            emitProgress(onProgress, loaded >= 1 ? "preparing" : "downloading", loaded);
          });
        },
      });
      emitProgress(onProgress, "available", 1);
      return { status: "available" };
    } finally {
      try {
        session?.destroy();
      } catch {
        // Resource cleanup is best effort; never obscure the setup result.
      }
    }
  }

  function assertPrompt(prompt) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new NativeAIError("invalid-prompt", "A non-empty text prompt is required.");
    }
  }

  async function ensureReady() {
    const state = await availability();
    if (state === "available") return;
    const stateError = setupErrorForState(state);
    if (stateError) throw stateError;
    throw new NativeAIError(
      "setup-required",
      "Set up Chrome on-device AI before using it for card suggestions."
    );
  }

  async function runPrompt({ systemPrompt = "", prompt, signal, responseConstraint } = {}) {
    assertPrompt(prompt);
    await ensureReady();

    const model = getLanguageModel();
    let session = null;
    try {
      const sessionOptions = {
        ...textCapabilities(),
        ...(signal ? { signal } : {}),
      };
      if (typeof systemPrompt === "string" && systemPrompt.trim()) {
        sessionOptions.initialPrompts = [{ role: "system", content: systemPrompt.trim() }];
      }
      session = await model.create(sessionOptions);

      const promptOptions = {
        ...(signal ? { signal } : {}),
        ...(responseConstraint ? { responseConstraint } : {}),
      };
      const result = await session.prompt(prompt, promptOptions);
      if (typeof result !== "string") {
        throw new NativeAIError("invalid-response", "Chrome on-device AI returned a non-text response.");
      }
      return result;
    } finally {
      try {
        session?.destroy();
      } catch {
        // Resource cleanup is best effort; never obscure the inference result.
      }
    }
  }

  async function promptText(options = {}) {
    return runPrompt(options);
  }

  async function promptStructured({ schema, ...options } = {}) {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      throw new NativeAIError("invalid-schema", "A JSON Schema object is required.");
    }
    const raw = await runPrompt({ ...options, responseConstraint: schema });
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new NativeAIError("invalid-response", "Chrome on-device AI returned invalid JSON.", error);
    }
  }

  async function runTask(kind, options = {}) {
    if (!TASK_KINDS.includes(kind)) {
      throw new NativeAIError("invalid-task", `Unsupported Chrome AI task: ${String(kind)}`);
    }
    return STRUCTURED_TASKS.has(kind)
      ? promptStructured(options)
      : promptText(options);
  }

  root.GHOSTWRITER_NATIVE_AI = Object.freeze({
    TASK_KINDS,
    NativeAIError,
    isSupported,
    availability,
    setup,
    promptText,
    promptStructured,
    runTask,
  });
})(window);
