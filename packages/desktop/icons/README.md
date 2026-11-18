# Desktop Icons

Onescience brand icons for Electron packaging (Windows `.ico`, macOS `.icns`, Linux PNGs).

## Regenerate

From `packages/desktop`:

```bash
bun ./scripts/render-app-icon.ts
python ./scripts/generate-onescience-icons.py
```

This renders `app-icon.png` from `@opencode-ai/ui` `onescience-mark.png` (official
Onescience mark pattern on a white rounded tile), then refreshes `icons/{prod,beta,dev}/`.

Do **not** use `packages/app/public/favicon-v3.svg` here — that SVG is a different
web-tile pattern, not the Onescience brand mark.

Requires: `bun`, `@resvg/resvg-js` (desktop devDependency), Python `pillow` + `icnsutil`.

## Packaging

`scripts/copy-icons.ts` copies `icons/{channel}` → `resources/icons` during
`predev` / `prebuild`. Electron Builder reads:

- Windows: `resources/icons/icon.ico` (installer + app)
- macOS: `resources/icons/icon.icns`
- Linux: `resources/icons/*.png`

Unpackaged macOS Dock uses `dock.png` via `app.dock.setIcon()`.
