import { existsSync, readdirSync, readFileSync } from "fs"
import path from "path"
import { Schema } from "effect"
import { CatalogBlobStore } from "@/catalog/blob-store"
import { OneSkills } from "@/oneskills"
import resourceMap from "./oneskills-primitive-resource-map.json"

export type OneskillsPrimitiveMetadata = {
  name: string
  type?: string
  domain?: string
  description?: string
  tags?: string[]
  version?: string
  visibility?: string
  created_at?: string
  updated_at?: string
}

export type ScannedOneskillsPrimitive = {
  assetKey: string
  metadata: OneskillsPrimitiveMetadata
  files: Record<string, string>
  absoluteDir: string
}

export type OneskillsResourceMapEntry = {
  source_resource_ids: string[]
  modelscope_title?: string
  primitive_type?: string
}

export const COMPANION_FILES = ["spec.md", "usage.md", "workflow_planning.md"] as const

export function companionDirFromAdapter(adapterJson: Record<string, unknown> | undefined) {
  const location = adapterJson?.location
  if (location && typeof location === "object" && location !== null) {
    const dir = (location as { path?: unknown }).path
    if (typeof dir === "string" && dir.trim() && existsSync(dir)) return dir
  }
  if (typeof adapterJson?.href === "string" && adapterJson.href.trim() && existsSync(adapterJson.href)) {
    return adapterJson.href
  }
  return undefined
}

export function loadPrimitiveCompanions(input: { id: string; adapterJson?: Record<string, unknown> }) {
  const companions: Record<string, string> = {}
  const blob = CatalogBlobStore.readPrimitiveBlob(input.id)
  const files = blob?.files
  if (files && typeof files === "object") {
    for (const name of COMPANION_FILES) {
      const content = (files as Record<string, unknown>)[name]
      if (typeof content === "string" && content.length > 0) companions[name] = content
    }
  }
  if (Object.keys(companions).length > 0) return companions

  const dir = companionDirFromAdapter(input.adapterJson)
  if (!dir) return companions
  for (const name of COMPANION_FILES) {
    const filePath = path.join(dir, name)
    if (!existsSync(filePath)) continue
    companions[name] = readFileSync(filePath, "utf8")
  }
  return companions
}

export const DOMAIN_LABEL: Record<string, string> = {
  meteorology: "地球科学",
  climate: "地球科学",
  bio: "生命科学",
  biology: "生命科学",
  matchem: "材料化学",
  materials: "材料化学",
  cfd: "流体仿真",
  fluid: "流体仿真",
}

/** Allowed catalog_search domain values: English aliases plus canonical Chinese labels. */
export const CatalogDomain = Schema.Literals([
  "meteorology",
  "climate",
  "bio",
  "biology",
  "matchem",
  "materials",
  "cfd",
  "fluid",
  "地球科学",
  "生命科学",
  "材料化学",
  "流体仿真",
]).annotate({
  description:
    "Primitive domain filter. English slugs (bio, climate, cfd, matchem, …) or Chinese labels (生命科学, 地球科学, 流体仿真, 材料化学).",
})
export type CatalogDomain = typeof CatalogDomain.Type

/** Expand an English slug or Chinese label into the full alias set used by catalog filters. */
export function catalogDomainAliases(domain: string) {
  const trimmed = domain.trim()
  if (!trimmed) return new Set<string>()
  const aliases = new Set<string>([trimmed])
  const lower = trimmed.toLowerCase()
  const fromKey = DOMAIN_LABEL[lower]
  if (fromKey) {
    aliases.add(lower)
    aliases.add(fromKey)
  }
  for (const [key, label] of Object.entries(DOMAIN_LABEL)) {
    if (label !== trimmed && key !== lower) continue
    aliases.add(key)
    aliases.add(label)
  }
  return aliases
}

export function domainsEquivalent(stored: string | undefined, query: string) {
  if (!stored?.trim()) return false
  const queryAliases = catalogDomainAliases(query)
  if (queryAliases.has(stored.trim())) return true
  const storedAliases = catalogDomainAliases(stored)
  for (const alias of queryAliases) {
    if (storedAliases.has(alias)) return true
  }
  return stored.trim().toLowerCase() === query.trim().toLowerCase()
}

type ResourceMap = Record<string, OneskillsResourceMapEntry>

export function oneskillsPrimitiveId(assetKey: string) {
  return `primitive-oneskills-${assetKey.replaceAll("/", "-")}`
}

export function oneskillsPrimitivesAssetsRoot(projectRoot = OneSkills.globalProjectRoot()) {
  return path.join(OneSkills.skillsDir(projectRoot), "onescience-primitives", "assets")
}

export function lookupOneskillsResourceMap(assetKey: string, map: ResourceMap = resourceMap as ResourceMap) {
  return map[assetKey]
}

export function pageForResourceId(resourceId: string) {
  if (resourceId.startsWith("seed-datasets-")) return "datasets"
  if (resourceId.startsWith("seed-models-")) return "models"
  if (resourceId.startsWith("seed-apps-")) return "apps"
  return undefined
}

export function domainLabel(domain: string | undefined, assetKey: string) {
  if (domain && DOMAIN_LABEL[domain]) return DOMAIN_LABEL[domain]
  const top = assetKey.split("/")[0]
  if (top && DOMAIN_LABEL[top]) return DOMAIN_LABEL[top]
  return "其它"
}

export function primitiveTypeForAsset(assetKey: string, metadataType: string | undefined) {
  const category = assetKey.split("/")[1]
  if (metadataType === "model" || category === "models") return "model"
  // datapipes are data-processing primitives; resource map only links source datasets
  if (category === "datapipes" || metadataType === "datapipe") return "data.transform"
  if (category === "application" || category === "apps") return "app.launch"
  if (category === "components") return "code.generate"
  if (category === "contracts") return "code.generate"
  if (category === "workflow-planning") return "workflow.compose"
  return "code.generate"
}

export function categoryTagForAsset(assetKey: string, primitiveType: string) {
  // A catalog dataset typically has two primitive kinds:
  // - dataset (data.load): the resource itself, often from OneHub-derived drafts
  // - data-processing (data.transform): oneskills datapipes that consume that dataset
  if (primitiveType === "data.load") return "dataset"
  if (primitiveType === "data.transform") return "data-processing"
  if (primitiveType === "model.train") return "model-training"
  if (primitiveType === "model.run") return "model-inference"
  if (primitiveType === "model") return "model"
  const category = assetKey.split("/")[1]
  if (category === "models") return "model"
  if (category === "datapipes") return "data-processing"
  if (category === "application" || category === "apps") return "app"
  if (category === "components") return "model-component"
  if (category === "contracts" || category === "workflow-planning") return "code-asset"
  return "code-asset"
}

function walkMetadataFiles(root: string, relative = ""): string[] {
  if (!existsSync(root)) return []
  const entries = readdirSync(root, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const childRel = relative ? `${relative}/${entry.name}` : entry.name
    const childAbs = path.join(root, entry.name)
    if (entry.isDirectory()) return walkMetadataFiles(childAbs, childRel)
    if (entry.isFile() && entry.name === "metadata.json") return [path.dirname(childRel).replaceAll("\\", "/")]
    return []
  })
}

export function scanOneskillsPrimitiveAssets(assetsRoot: string): ScannedOneskillsPrimitive[] {
  return walkMetadataFiles(assetsRoot).flatMap((assetKey) => {
    if (!assetKey || assetKey === ".") return []
    const absoluteDir = path.join(assetsRoot, ...assetKey.split("/"))
    const metadataPath = path.join(absoluteDir, "metadata.json")
    if (!existsSync(metadataPath)) return []
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as OneskillsPrimitiveMetadata
    if (!metadata.name?.trim()) return []

    const files: Record<string, string> = {}
    for (const name of COMPANION_FILES) {
      const filePath = path.join(absoluteDir, name)
      if (!existsSync(filePath)) continue
      files[name] = readFileSync(filePath, "utf8")
    }

    return [{ assetKey, metadata, files, absoluteDir }]
  })
}

export type OneskillsSeedPrimitive = {
  id: string
  title: string
  copy: string
  tags: string[]
  provider: string
  size: string
  format: string
  href: string
  domain: string
  assetKey: string
  files: Record<string, string>
  metadata: OneskillsPrimitiveMetadata
}

export type OneskillsSeedEntry = {
  assetKey: string
  metadata: OneskillsPrimitiveMetadata
  files: Record<string, string>
  href?: string
}

export function bundledAssetHref(assetKey: string) {
  return `bundled:oneskills-primitive-seed/${assetKey}`
}

export function seedPrimitivesFromEntries(entries: OneskillsSeedEntry[], map: ResourceMap = resourceMap as ResourceMap): OneskillsSeedPrimitive[] {
  return entries.map((item) => {
    const mapped = lookupOneskillsResourceMap(item.assetKey, map)
    const resourceIds = mapped?.source_resource_ids ?? []
    const primitiveType = mapped?.primitive_type ?? primitiveTypeForAsset(item.assetKey, item.metadata.type)
    const category = categoryTagForAsset(item.assetKey, primitiveType)
    const domain = domainLabel(item.metadata.domain, item.assetKey)
    const page = resourceIds
      .map((id) => pageForResourceId(id))
      .find((value): value is "datasets" | "models" | "apps" => value === "datasets" || value === "models" || value === "apps")
    const skill = category === "app" || category === "model-inference" || category === "model-training" ? "onescience-runtime" : "onescience-coder"
    const group =
      category === "dataset"
        ? "Data Resources"
        : category === "data-processing"
          ? "DataPipes"
          : category === "model" || category === "model-inference" || category === "model-training"
            ? "Model Resources"
            : category === "app"
              ? "App Launchers"
              : category === "model-component"
                ? "AI Modules"
                : "Coder Assets"

    const tags = [
      domain,
      group,
      `category:${category}`,
      `skill:${skill}`,
      ...(page ? [`source:${page}`] : []),
      ...resourceIds.map((id) => `resource:${id}`),
      ...(mapped?.modelscope_title ? [`model:${mapped.modelscope_title}`] : []),
      ...(item.metadata.tags ?? []),
    ]

    return {
      id: oneskillsPrimitiveId(item.assetKey),
      title: item.metadata.name,
      copy: item.metadata.description?.trim() || item.metadata.name,
      tags,
      provider: "oneskills",
      size: primitiveType,
      format: item.metadata.type ?? "asset",
      href: item.href ?? bundledAssetHref(item.assetKey),
      domain,
      assetKey: item.assetKey,
      files: item.files,
      metadata: item.metadata,
    }
  })
}

export function seedPrimitivesFromOneskillsAssets(assetsRoot: string, map: ResourceMap = resourceMap as ResourceMap): OneskillsSeedPrimitive[] {
  return seedPrimitivesFromEntries(
    scanOneskillsPrimitiveAssets(assetsRoot).map((item) => ({
      assetKey: item.assetKey,
      metadata: item.metadata,
      files: item.files,
      href: item.absoluteDir,
    })),
    map,
  )
}

export * as OneskillsPrimitiveIngest from "./oneskills-primitive-ingest"
