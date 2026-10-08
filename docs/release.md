# Release Process

`npm run build:release` builds MathJax and creates `dist/ghostwriter/` plus `dist/ghostwriter.zip` locally. The builder copies only its explicit resource list, requires tracked source inputs, permits the two generated MathJax files, rejects symlinks in input paths, and checks the complete release tree before archiving it.

Production builds disable content and panel test modes. `GHOSTWRITER_BUILD_TEST_HOOKS=1` is an explicit test-build option; never upload its output.

## Release checklist

1. Obtain the author's release approval. Stage 1 was accepted after testing on October 5, 2026. Store privacy attestations still require operational review; implementation acceptance does not authorize publication.
2. Align the version in `manifest.json`, `package.json`, both root entries in `package-lock.json`, and the README version line with the approved release. `manifest.json` is the extension's version source of truth.
3. Run the unit suite and lint checks, then build without `GHOSTWRITER_BUILD_TEST_HOOKS`.
4. Check that the ZIP contains exactly the allowed resources and both production test modes are disabled. Load a fresh unzip for browser checks, rather than relying only on the source checkout.
5. Test a real Anki Basic/Cloze card and pasted image, PDF right-click selection, and Windows/Linux shortcuts. Use an explicitly approved disposable deck or collection for real add operations.
6. Test the legacy recovery backup and failed-backup retry with fixtures. Confirm that images referenced by the backup or a draft are kept, that images Anki has saved are removed locally, and that drafts, preferences and provider keys survive.
7. Reconcile the privacy policy, store data categories, permission justifications and public copy with the actual release. Present exact attestation values to the author before submitting them.
8. Confirm all bundled license/privacy notices remain in the archive. Push, upload to the store or publish a GitHub release only after explicit authorization for that action.

A locally built ZIP is a review artifact until publication is authorized. Installation docs should link to the store and should offer a downloadable ZIP only when a corresponding published asset exists.
