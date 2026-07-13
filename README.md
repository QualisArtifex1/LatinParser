# LatinParser

The app uses a local conversion of Whitaker's Words data. Its dictionary logic is checked at three levels:

1. `node --test open-words.test.mjs` runs focused regressions for previously discovered parsing bugs.
2. `node dictionary-audit.mjs` validates the imported data, exercises representative surface forms from 1,754 inflection rules, and checks a curated cross-part-of-speech corpus.
3. `node dictionary-audit.mjs --live` additionally compares every locally displayed morphological form in that corpus with the current output from [latin-words.com](https://latin-words.com/).

The offline checks run automatically on every push and pull request through GitHub Actions. From the repository's **Actions → Dictionary audit → Run workflow** screen, enable **Compare the curated corpus with latin-words.com** to run the live differential check.

When a bug is found, add its token and expected entry to `reference-cases.json`, then add a focused assertion to `open-words.test.mjs`. This makes the correction permanent and also expands future live comparisons.

`open-words/word-corrections.json` contains records that are absent from the converted source data but confirmed against the reference implementation. Keeping those records separate makes conversion gaps visible and reviewable.
