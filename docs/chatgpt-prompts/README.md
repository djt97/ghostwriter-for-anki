# ChatGPT prompts (optional AI imagery)

The store assets in [`../store-screenshots/`](../store-screenshots/) were designed and rendered locally
(no AI art needed):

- `marquee-1400x560.png` — large promo tile for the Chrome Web Store
- `promo-tile-440x280.png` — small promo tile
- `video-thumbnail-1280x720.png` — a clean, text-based YouTube thumbnail

These are ready to use as-is. This folder is only for the **optional** case where you'd rather have an
AI-generated / photo-based thumbnail (e.g. one with your face in it), which I can't render locally.

## How to use
1. Open ChatGPT (a model with image generation, e.g. GPT‑4o / GPT image).
2. Paste the prompt from `video-thumbnail-prompt.md`.
3. Attach the reference image in `assets/` (drag it in) — and a photo of yourself if you want to appear in it.
4. Iterate: ask for tweaks ("more contrast", "move the text left", "make the card larger").

## Files
- `video-thumbnail-prompt.md` — prompt for a 1280×720 YouTube thumbnail
- `assets/app-overlay.png` — a clean screenshot of the extension overlay, to attach for reference/inclusion
