// defaults.js — Single source of truth for option default values.
// Loaded by panel.html and options.html before their main scripts.
// Both panel.js and options.js should use these instead of hardcoding fallbacks.

window.GHOSTWRITER_DEFAULTS = Object.freeze({
  // Copilot behaviour
  autoCompleteAI: true,
  autoFillBackAI: true,
  manualCopilotOnly: true,
  showMiniCopilotMode: "off",
  showSourceModePill: true,
  copilotShortcut: "Cmd+Shift+X",
  copilotFrontWordCap: 24,
  copilotBackWordCap: 18,
  copilotFrontMaxTokens: 48,
  copilotBackMaxTokens: 36,
  copilotMinIntervalMs: 1200,
  copilotTimeoutMs: 30000,

  // Anki integration
  defaultDeck: "All Decks",
  ankiBaseUrl: "http://127.0.0.1:8765",

  // Tagging
  appendQuickflashTag: true,
  quickflashTagName: "ghostwriter",

  // Manual editor helpers
  manualAutoTag: true,
  manualAutoContext: true,
  manualAutoPreview: false,

  // Field visibility
  showContextField: true,
  showSourceField: true,
  showNotesField: false,

  // Editor
  editorViewMode: "auto",
  defaultEditorSurface: "overlay",
  closeOverlayAfterQueue: false,
  showShortcutHints: true,

  // Debug
  debugMode: false,
});
