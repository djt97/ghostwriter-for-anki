# Ghostwriter for Anki – Store Listing Notes

## Network Access Summary
The extension communicates only with the domains below, based on user configuration and features used:

- `http://127.0.0.1:*`, `http://localhost:*` — Local AnkiConnect endpoint for creating flashcards in the user’s desktop Anki instance.
- `https://api.openai.com` — OpenAI API requests when the user selects the OpenAI provider.
- `https://smart.ultimateai.org` — UltimateAI OpenAI-compatible API requests when the user selects the UltimateAI provider.
- `https://generativelanguage.googleapis.com` — Google Gemini API requests when the user selects the Gemini provider.
- `https://huggingface.co` — Retrieves model manifests and metadata when downloading the optional local embedding model.
- `https://cdn-lfs.huggingface.co` — Downloads model weight files stored on Hugging Face LFS for the optional local embedding model.
- `https://cdn-lfs.hf.co` — Alternate Hugging Face LFS CDN endpoint used during model weight downloads for the optional local embedding model.

## Model Assets Hosting Note
The embedding model is currently fetched from Hugging Face on first use to avoid bundling large model assets into the extension package. We are evaluating hosting these assets directly inside the extension when size constraints allow, to eliminate external model downloads.

## Permissions Justification
- Clipboard read: used only when the user enables clipboard-as-Source or when no page selection is available, to populate the Source text.
- Active tab + scripting: used to inject the content script only after the user invokes the extension, so selection/context can be captured on demand.
- Tabs: used to read the active tab’s selection/context and open the dashboard or side panel in the correct tab.
- Host permissions: limited to the specific API endpoints (OpenAI, UltimateAI, Gemini), Hugging Face model download hosts, and local AnkiConnect (localhost/127.0.0.1) required for user-configured features.

## Privacy Policy
Settings and API keys are stored locally in browser storage, and may sync via `chrome.storage.sync` if you enable browser sync.

Read the privacy policy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
