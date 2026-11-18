/**
 * Render packages/desktop/app-icon.png from the official Onescience mark
 * (`@opencode-ai/ui` onescience-mark.png). Do NOT use favicon-v3.svg — that file
 * is a different geometric pattern (white-on-red web tile), not the brand mark.
 *
 * Usage (from packages/desktop):
 *   bun ./scripts/render-app-icon.ts
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Resvg } from "@resvg/resvg-js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const markPath = resolve(root, "../ui/src/assets/images/onescience-mark.png")
const outPath = resolve(root, "app-icon.png")
const size = 1024
const inset = Math.round(size * (32 / 512))
const radius = Math.round(size * (96 / 512))
const pad = Math.round((size - inset * 2) * 0.1)

// Compose: white rounded square + official red mark (black backdrop in source → transparent).
const mark = readFileSync(markPath).toString("base64")
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <clipPath id="tile">
      <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" ry="${radius}"/>
    </clipPath>
  </defs>
  <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius}" ry="${radius}" fill="#FFFFFF"/>
  <image
    href="data:image/png;base64,${mark}"
    x="${inset + pad}"
    y="${inset + pad}"
    width="${size - inset * 2 - pad * 2}"
    height="${size - inset * 2 - pad * 2}"
    clip-path="url(#tile)"
    preserveAspectRatio="xMidYMid meet"
    style="mix-blend-mode: multiply"
  />
</svg>`

const png = new Resvg(Buffer.from(svg), { fitTo: { mode: "width", value: size } }).render().asPng()
writeFileSync(outPath, png)
console.log(`Wrote ${outPath} from onescience-mark.png (${png.byteLength} bytes)`)
