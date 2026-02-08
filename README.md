# Ghostwriter for Anki (Chrome/Edge, Manifest V3)

**Current Version: 0.3.0**

Ghostwriter for Anki is an AI-assisted card creator for Anki. It blends manual authoring with LLM-powered suggestions ("Copilot") and a high-speed triage queue for bulk generation.

### 🚀 What's New in v0.3.0
* **Unified Editor**: One interface for everything. Type manually, or paste source text to enter "Triage Mode."
* **AI Copilot**: Ghost-text suggestions appear while you type. Press `Tab` to accept a completion for the Front or Back. Supports **Google Gemini** (streaming) and **UltimateAI**.
* **Smart Generation**: Select text on a webpage and click **"Smart Gen"**. The AI automatically picks the best template (Concept, Definition, etc.) and generates cards.
* **Triage Queue**: AI-generated cards enter a queue. Review them with keyboard shortcuts (`A`ccept, `R`eject/Skip) before sending to Anki.
* **Outbox & Undo**: Accepted cards sit in an Outbox. You can **Edit** them (pulling them back into the editor) or **Undo** the last batch sent to Anki.

---

### 🛠 Setup & Install

1.  **AnkiConnect**: Install the **AnkiConnect** add-on (ID `2055492159`) in your desktop Anki app. Keep Anki running.
2.  **Download the zip**: Grab the **lite** or **full** zip bundle. The **lite** bundle excludes knowledge graph features/dependencies, while the **full** bundle includes them.
3.  **Unzip**: Extract the zip to a folder on your machine.
4.  **Load Extension**:
    * Open `chrome://extensions`.
    * Enable **Developer mode**.
    * Click **Load unpacked**.
    * Select the unzipped folder.
5.  **Shortcuts**: Set a trigger shortcut (default `Cmd+Shift+F`) at `chrome://extensions/shortcuts`.
6.  **API Keys**: Open the extension **Options**. You must add an API Key for either **Google Gemini**, **OpenAI**, or **UltimateAI**.

---

### ⚙️ Configuration

**Providers**
* **Google Gemini**: Add your Gemini key (models listed at https://ai.google.dev/gemini-api/docs/models). Default model: `gemini-2.5-flash-lite`.
* **UltimateAI**: OpenAI-compatible endpoint (docs at https://chat.ultimateai.org/apidocs). Default model: `gpt-4o-mini`.
* **OpenAI**: Model list at https://platform.openai.com/docs/models. Default model: `gpt-4o-mini`.

**AI Tuning**
* **Max Tokens**: If using "Reasoning" models (like Gemini Pro or ChatGPT Thinking), increase **Back Max Tokens** to `1000+` to allow the model to "think" before answering.
* **Templates**: You can add custom prompts in the "Manage AI Templates" section (e.g., "Extract Spanish Vocabulary").

**Quick Options (In-Panel)**
The editor has a "Quick Options" grid to toggle behavior on the fly:
* **Fill Source**: Auto-fill the `Source` field with the page URL/Selection.
* **Auto-Context**: Use AI to generate a context line (e.g., "Chapter 3 - Deep Learning").
* **Auto-Tag**: Ask AI to suggest tags based on the card content.

---

### ⌨️ Usage Guide

#### 1. Manual Mode + Copilot
* Open the panel (`Cmd+Shift+F`).
* Type in the **Front**. The Copilot will suggest a completion in gray text.
* Press **Tab** (or the discrete "Accept" button) to use the suggestion.
* Press **Cmd+Enter** (or `Ctrl+Enter`) to add the card to the Outbox.

#### 2. AI Generation ("Smart Gen")
* Highlight text on a webpage.
* Click **"Smart Gen"** in the toolbar (or select a specific template).
* Use **Cmd+Shift+G** to open the AI-generated templates panel for quick access.
* The extension generates cards and enters **Triage Mode**.

#### 3. Triage Mode
When cards are in the queue, the editor transforms into a review tool.
* **Shortcuts:**
    * `A`: **Accept** (Move to Outbox).
    * `R`: **Reject/Skip**.
    * `←` / `→`: Navigate queue.
    * `J`: Open JSON import (paste cards from ChatGPT/Claude).
* **Sticky Footer**: A navigation bar appears at the bottom for mouse users.

#### 4. The Outbox
* Accepted cards appear in a list at the bottom.
* **Edit**: Click "Edit" on any card to pull it back into the main editor for changes.
* **Send**: Click **"Send outbox to Anki"** to commit them to your deck.

---

### 🔧 Troubleshooting
* **"Max tokens reached"**: If using a Reasoning model (Gemini Pro/Flash 2.0), the model uses hidden tokens to think. Go to Options and increase the **Front/Back Max Tokens** limit.
* **AnkiConnect Error**: Ensure Anki is open. If on Android/Remote, copy the "Extension Origin" from Options and add it to your `webCorsOriginList` in AnkiConnect config.

---

### 📄 Third-Party Notices
This project bundles third-party libraries. Their license texts are kept in `/licences` and should accompany any distribution of the extension:

* **Force Graph** (`force-graph.js`): MIT License. See `licences/force-graph-MIT.txt` and the upstream project at https://github.com/vasturiano/force-graph.
* **Hugging Face Transformers** (`vendor/transformers/transformers.esm.js`): Apache License 2.0. See `licences/transformers-APACHE.txt` and the upstream project at https://github.com/huggingface/transformers.
* **ONNX Runtime Web** (`vendor/onnx/`): MIT License. MIT headers are present in the bundled files; keep these notices with any distributed build.
