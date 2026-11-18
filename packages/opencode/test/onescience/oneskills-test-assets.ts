import { mkdirSync } from "fs"
import path from "path"

export async function writeOneskillsAsset(
  assetsRoot: string,
  assetKey: string,
  metadata: Record<string, unknown>,
  files: Record<string, string> = {},
) {
  const dir = path.join(assetsRoot, ...assetKey.split("/"))
  mkdirSync(dir, { recursive: true })
  await Bun.write(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2))
  for (const [name, content] of Object.entries(files)) {
    await Bun.write(path.join(dir, name), content)
  }
}

/** Minimal seeded assets covering OneHub-mapped climate primitives used by tests. */
export async function writeDefaultOneskillsTestAssets(assetsRoot: string) {
  await writeOneskillsAsset(assetsRoot, "climate/models/graphcast", {
    name: "graphcast",
    type: "model",
    domain: "meteorology",
    description: "GraphCast weather forecast primitive",
    tags: ["weather-forecast", "graphcast"],
    version: "1.0.0",
  })
  await writeOneskillsAsset(assetsRoot, "climate/models/fuxi", {
    name: "fuxi",
    type: "model",
    domain: "meteorology",
    description: "FuXi forecast primitive",
    tags: ["weather-forecast", "fuxi"],
    version: "1.0.0",
  })
  await writeOneskillsAsset(assetsRoot, "climate/datapipes/era5", {
    name: "era5",
    type: "datapipe",
    domain: "meteorology",
    description: "ERA5 datapipe primitive",
    tags: ["era5", "weather"],
    version: "1.0.0",
  })
  await writeOneskillsAsset(assetsRoot, "bio/models/alphafold", {
    name: "alphafold",
    type: "model",
    domain: "bio",
    description: "AlphaFold structure prediction",
    tags: ["protein"],
    version: "1.0.0",
  })
  await writeOneskillsAsset(assetsRoot, "bio/models/openfold", {
    name: "openfold",
    type: "model",
    domain: "bio",
    description: "OpenFold model primitive",
    tags: ["protein"],
    version: "1.0.0",
  })
  await writeOneskillsAsset(assetsRoot, "cfd/datapipes/cfdbench", {
    name: "cfdbench",
    type: "datapipe",
    domain: "cfd",
    description: "CFDBench datapipe",
    tags: ["cfd"],
    version: "1.0.0",
  })
}

export function emptyAssetsRoot(base: string) {
  const root = path.join(base, "empty-oneskills-assets")
  mkdirSync(root, { recursive: true })
  return root
}
