# pixel-loader-lab

A tiny, standalone sandbox for iterating on a pixelated, animated loader derived from an app icon.

## Prereqs
- Node LTS
- ffmpeg (macOS):
  - `brew install ffmpeg`

## Setup
1. `npm install`
2. Copy your icon into `src/assets/icon-source.png` or `src/assets/logo.svg`

## Run
- `npm run dev` (opens the preview page)
- In another terminal: `npm run build:loader`

## Notes
- Generated output lives at `src/assets/loader.gif` (copy this into the main app when ready).
- `image-rendering: pixelated` is applied in `src/styles.css`.
- `npm run stats` prints dimensions + sizes for input/output images.
