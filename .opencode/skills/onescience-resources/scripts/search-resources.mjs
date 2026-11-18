#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2))
const server = String(args.server || process.env.ONESCIENCE_SERVER_URL || "http://127.0.0.1:8006").replace(/\/$/, "")
const limit = clampNumber(Number(args.limit || 12), 1, 100)
const query = String(args.query || args.q || "").trim().toLowerCase()
const type = String(args.type || "all")
const json = Boolean(args.json)

const resourceTypes = ["datasets", "models", "apps", "frameworks"]
const selectedTypes = type === "all" ? [...resourceTypes, "skills", "primitives"] : [type]

try {
  const results = (await Promise.all(selectedTypes.map((item) => loadType(item)))).flat()
  const filtered = results.filter((item) => matches(item, query)).slice(0, limit)
  if (json) {
    console.log(JSON.stringify({ server, query, type, count: filtered.length, items: filtered }, null, 2))
    process.exit(0)
  }
  printMarkdown(filtered)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

async function loadType(item) {
  if (resourceTypes.includes(item)) return loadResources(item)
  if (item === "skills") return loadSkills()
  if (item === "primitives") return loadPrimitives()
  throw new Error(`Unsupported --type "${item}". Use all, ${[...resourceTypes, "skills", "primitives"].join(", ")}.`)
}

async function loadResources(page) {
  const params = new URLSearchParams({ page, limit: "100" })
  if (args.domain) params.set("domain", String(args.domain))
  return (await fetchJson(`/experimental/onescience/resource?${params}`)).items.map((item) => ({
    type: page,
    id: item.id,
    title: item.title,
    description: item.copy,
    domain: item.domain,
    tags: item.tags || [],
    provider: item.provider,
    format: item.format,
    source: item.source,
    href: item.href,
    action: item.action,
  }))
}

async function loadSkills() {
  const params = new URLSearchParams({ includePrimitives: "true", limit: "100" })
  if (args.domain) params.set("layer", String(args.domain))
  return (await fetchJson(`/experimental/onescience/skill?${params}`)).items.map((item) => ({
    type: "skills",
    id: item.id,
    title: item.title,
    description: item.copy,
    domain: item.layer,
    tags: [item.layer, ...(item.tags || [])].filter(Boolean),
    primitives: (item.primitives || []).map((primitive) => ({
      id: primitive.id,
      title: primitive.title,
      primitiveType: primitive.primitiveType,
      domain: primitive.domain,
    })),
  }))
}

async function loadPrimitives() {
  const params = new URLSearchParams({ limit: "100" })
  if (args.domain) params.set("domain", String(args.domain))
  if (args["primitive-type"]) params.set("primitiveType", String(args["primitive-type"]))
  if (args.status) params.set("status", String(args.status))
  return (await fetchJson(`/experimental/onescience/primitive?${params}`)).items.map((item) => ({
    type: "primitives",
    id: item.id,
    title: item.title,
    description: item.description,
    domain: item.domain,
    tags: item.intentTags || [],
    primitiveType: item.primitiveType,
    status: item.status,
    resources: item.resources || [],
    contractJson: item.contractJson,
    adapterJson: item.adapterJson,
    validationJson: item.validationJson,
  }))
}

async function fetchJson(path) {
  const response = await fetch(`${server}${path}`)
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`)
  return response.json()
}

function matches(item, value) {
  if (!value) return true
  return JSON.stringify(item).toLowerCase().includes(value)
}

function printMarkdown(items) {
  if (items.length === 0) {
    console.log("No OneScience resources matched the query.")
    return
  }
  for (const item of items) {
    console.log(`- [${item.type}] ${item.title} (${item.id})`)
    if (item.domain) console.log(`  domain: ${item.domain}`)
    if (item.primitiveType) console.log(`  primitiveType: ${item.primitiveType}`)
    if (item.description) console.log(`  summary: ${oneLine(item.description)}`)
    if (item.tags?.length) console.log(`  tags: ${item.tags.slice(0, 8).join(", ")}`)
    if (item.provider || item.format) console.log(`  meta: ${[item.provider, item.format].filter(Boolean).join(" · ")}`)
    if (item.href) console.log(`  href: ${item.href}`)
    if (item.resources?.length) console.log(`  linked: ${item.resources.slice(0, 4).map((resource) => `${resource.title || resource.id}(${resource.relationType || "resource"})`).join(", ")}`)
    if (item.primitives?.length) console.log(`  primitives: ${item.primitives.slice(0, 8).map((primitive) => `${primitive.title || primitive.id}${primitive.primitiveType ? `/${primitive.primitiveType}` : ""}`).join(", ")}`)
    if (item.contractJson) console.log(`  contract: ${summarizeContract(item.contractJson)}`)
  }
}

function summarizeContract(contract) {
  const text = JSON.stringify(contract)
  return oneLine(text.length > 220 ? `${text.slice(0, 220)}…` : text)
}

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim()
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function parseArgs(argv) {
  return argv.reduce((result, item, index) => {
    if (!item.startsWith("--")) return result
    const key = item.slice(2)
    const next = argv[index + 1]
    return { ...result, [key]: next && !next.startsWith("--") ? next : true }
  }, {})
}
