// Options-page controller for Chrome's on-device Prompt API. Availability checks
// are read-only; only the explicit setup button may create/download a model.
(function initNativeAIOptions(root) {
  "use strict";

  const api = root.GHOSTWRITER_NATIVE_AI;
  let initialized = false;
  let availabilityState = "checking";
  let requestedEnabledPreference = false;

  function element(id) {
    return document.getElementById(id);
  }

  function readPreferences() {
    return {
      nativeAiEnabled: element("nativeAiEnabled")?.value === "true",
      nativeAiHostedFallback: element("nativeAiHostedFallback")?.value === "true",
    };
  }

  function applyPreferences(options = {}) {
    const defaults = root.GHOSTWRITER_DEFAULTS || {};
    const enabled = element("nativeAiEnabled");
    const hostedFallback = element("nativeAiHostedFallback");
    requestedEnabledPreference = !!(
      options.nativeAiEnabled ?? defaults.nativeAiEnabled ?? false
    );
    if (enabled) {
      const canEnable = availabilityState === "available";
      enabled.value = String(canEnable && requestedEnabledPreference);
      enabled.disabled = !canEnable;
    }
    if (hostedFallback) {
      hostedFallback.value = String(
        options.nativeAiHostedFallback ?? defaults.nativeAiHostedFallback ?? false
      );
    }
    syncPreferenceState();
  }

  function syncPreferenceState() {
    const enabled = element("nativeAiEnabled")?.value === "true";
    const hostedFallback = element("nativeAiHostedFallback");
    if (hostedFallback) hostedFallback.disabled = !enabled;
  }

  function setStatus(message, state) {
    const status = element("nativeAiStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state || "checking";
  }

  function setProgress({ status, loaded }) {
    const progress = element("nativeAiProgress");
    const progressText = element("nativeAiProgressText");
    if (!progress || !progressText) return;

    if (status === "downloading") {
      progress.hidden = false;
      progress.value = loaded;
      progressText.hidden = false;
      progressText.textContent = `Downloading model: ${Math.round(loaded * 100)}%`;
    } else if (status === "preparing") {
      progress.hidden = false;
      progress.removeAttribute("value");
      progressText.hidden = false;
      progressText.textContent = "Preparing the model on this device…";
    } else {
      progress.hidden = true;
      progress.value = 0;
      progressText.hidden = true;
      progressText.textContent = "";
    }
  }

  function renderAvailability(state) {
    const setupButton = element("nativeAiSetup");
    const enabled = element("nativeAiEnabled");
    availabilityState = state;
    setProgress({ status: state, loaded: 0 });

    const canEnable = state === "available";
    if (enabled) {
      enabled.disabled = !canEnable;
      enabled.value = String(canEnable && requestedEnabledPreference);
    }
    syncPreferenceState();
    if (!setupButton) return;

    setupButton.hidden = false;
    setupButton.disabled = false;
    if (state === "available") {
      setStatus("Ready. Card text is processed on this device.", "available");
      setupButton.textContent = "Chrome AI ready";
      setupButton.disabled = true;
    } else if (state === "downloadable") {
      setStatus("Available after a one-time model download managed by Chrome.", "downloadable");
      setupButton.textContent = "Set up Chrome on-device AI";
    } else if (state === "downloading") {
      setStatus("Chrome has started downloading the model. Continue setup to monitor it.", "downloading");
      setupButton.textContent = "Continue setup";
    } else if (state === "unsupported") {
      setStatus("Not supported in this browser. Chrome desktop 138 or newer is required.", "unavailable");
      setupButton.textContent = "Not supported";
      setupButton.disabled = true;
    } else {
      setStatus("Unavailable on this device. Check Chrome's built-in AI requirements.", "unavailable");
      setupButton.textContent = "Unavailable";
      setupButton.disabled = true;
    }
  }

  async function refreshStatus() {
    setStatus("Checking this device…", "checking");
    const state = api && typeof api.availability === "function"
      ? await api.availability()
      : "unsupported";
    renderAvailability(state);
    return state;
  }

  async function handleSetup() {
    const setupButton = element("nativeAiSetup");
    if (!api || typeof api.setup !== "function" || !setupButton) return;
    setupButton.disabled = true;
    setStatus("Starting Chrome on-device AI setup…", "downloading");
    setProgress({ status: "downloading", loaded: 0 });
    try {
      await api.setup({
        onProgress(update) {
          setProgress(update);
          if (update.status === "preparing") {
            setStatus("Download complete. Preparing the model…", "preparing");
          } else if (update.status === "downloading") {
            setStatus("Downloading the Chrome on-device model…", "downloading");
          }
        },
      });
      const enabled = element("nativeAiEnabled");
      requestedEnabledPreference = true;
      if (enabled) enabled.value = "true";
      syncPreferenceState();
      renderAvailability("available");
      setStatus("Ready. Card text is processed on this device. Click Save changes to use Chrome AI.", "available");
    } catch (error) {
      setProgress({ status: "unavailable", loaded: 0 });
      setStatus(error?.message || "Chrome on-device AI setup failed.", "error");
      setupButton.textContent = "Try setup again";
      setupButton.disabled = false;
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const setupButton = element("nativeAiSetup");
    const enabled = element("nativeAiEnabled");
    if (setupButton) {
      setupButton.addEventListener("click", (event) => {
        event.preventDefault();
        handleSetup();
      });
    }
    if (enabled) enabled.addEventListener("change", () => {
      requestedEnabledPreference = enabled.value === "true";
      syncPreferenceState();
    });
    syncPreferenceState();
    refreshStatus();
  }

  root.GHOSTWRITER_NATIVE_AI_OPTIONS = Object.freeze({
    init,
    refreshStatus,
    readPreferences,
    applyPreferences,
  });
})(window);
