# Keeping the v1 knowledge graph (removed in v2) — DRAFT

> Draft for DJ to edit before publishing. Intended as the link target from the
> v2 release notes and the store listing changelog.

Ghostwriter v2 (0.4.x) removed the knowledge-graph dashboard and its embedding
machinery to keep the extension small and focused on card creation. If you used
the graph in v1, nothing of yours has been deleted:

- Your cards live in Anki, untouched.
- The graph's embeddings were derived data, computed locally in your browser
  from your synced collection. v2 simply stops reading them (it does not delete
  them either).

## Keep using the graph

The last version with the full knowledge graph is preserved on the
[`legacy-knowledge-graph`](https://github.com/djt97/ghostwriter-for-anki/tree/legacy-knowledge-graph)
branch. It is self-contained — the ONNX runtime, force-graph, and MathJax
assets are committed — so it loads as an unpacked extension with no build step:

1. Download the branch as a zip:
   <https://github.com/djt97/ghostwriter-for-anki/archive/refs/heads/legacy-knowledge-graph.zip>
   and unzip it somewhere permanent (the browser reloads it from that folder).
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer
   mode**, click **Load unpacked**, and select the unzipped folder.
   - Use a separate browser profile or a different Chromium browser, so the
     legacy extension and the store version don't both inject into the pages
     you read.
3. Make sure desktop Anki is running with the AnkiConnect add-on (2055492159),
   then check the extension's Options if you use a non-default endpoint
   (`http://127.0.0.1:8765`).
4. Open the panel and follow its Dashboard link (or visit
   `chrome-extension://<extension-id>/dashboard.html` directly), then sync your
   collection. Embeddings regenerate locally.
   - The first sync downloads the embedding model
     (`Xenova/bge-small-en-v1.5`, ~30 MB) from Hugging Face and caches it;
     the embedding computation itself runs entirely on your machine.

## Can I reuse my existing embeddings?

Not directly. Embeddings are stored in IndexedDB, which is private to each
extension install, so a fresh unpacked install cannot read the store version's
data. In practice this doesn't matter: re-syncing regenerates them from your
collection — the same computation over the same cards. (Your old embedding data
still sits untouched in the store extension's storage; the v2 update neither
reads nor deletes it.)

If you exported an archive JSON from the v1 dashboard
(`quickflash-archive-<date>.json`), the legacy build can re-import it as
before.

## Questions

Open an issue: <https://github.com/djt97/ghostwriter-for-anki/issues>
