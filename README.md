# Latin Vocab App

A static React/Vite web app that runs the Open Words Latin parser entirely in the browser. It does not need a Python backend at runtime, so it can be hosted on GitHub Pages or embedded into another static website.

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Build

```bash
npm run build
```

The deployable static site is written to `dist/`.

## GitHub Pages

This repo includes `.github/workflows/deploy.yml`, which builds `dist/` and deploys it to GitHub Pages on pushes to `main`.

In GitHub, set **Settings > Pages > Build and deployment > Source** to **GitHub Actions**. The workflow uses GitHub's Pages actions to upload and deploy the static artifact.

## Open Words Data

Runtime parser data lives in `public/open-words/*.json` and is copied into `dist/open-words/` during build.

To refresh those JSON assets from a local copy of the legacy package:

```bash
npm run export:open-words
```

By default the export script looks for `~/Documents/open_words`. To point at another copy:

```bash
OPEN_WORDS_PATH=/path/to/open_words npm run export:open-words
```

The generated JSON files are committed so GitHub Pages builds do not need the old Python package.
