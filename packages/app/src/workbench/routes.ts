import { base64Encode } from "@opencode-ai/core/util/encode"

export const workspaceRoutes = {
  root: "/workspace",
  capabilities: "/workspace/capabilities",
  skills: "/workspace/skills",
  docs: "/workspace/docs",
  resources: "/workspace/resources",
  session: "/workspace/:dir/session/:id?",
} as const

/** Web marketing landing page; desktop has no marketing shell. */
export const marketingHomeRoute = "/" as const

export function hasMarketingHome(platform: "web" | "desktop") {
  return platform !== "desktop"
}

/** Sidebar brand target: marketing home on web, workbench root on desktop. */
export function shellBrandHref(platform: "web" | "desktop") {
  return hasMarketingHome(platform) ? marketingHomeRoute : workspaceRoutes.root
}

export function shellBrandName(platform: "web" | "desktop") {
  return platform === "desktop" ? "OneCode" : "OneScience"
}

/** Base OneScience Gitee source tree (domain paths live on each capability). */
export const oneScienceSourceHref = "https://gitee.com/onescience-ai/onescience"

export type CapabilityCategoryParam = "scenario" | "onemodel" | "hpc" | "onedata" | "oneskills" | "submission"
export type CapabilityDomainParam = "materials" | "weather" | "fluid" | "bio" | "all"

export function workspaceCapabilitiesHref() {
  return workspaceRoutes.capabilities
}

export function workspaceCapabilitiesCategoryHref(
  category: CapabilityCategoryParam,
  domain?: CapabilityDomainParam,
) {
  const params = new URLSearchParams({ category })
  // Keep domain=all explicit so a missing domain is not reinterpreted as 材料.
  if (domain) params.set("domain", domain)
  return `${workspaceRoutes.capabilities}?${params}`
}

export function workspaceHomeHref(cases?: "open" | string) {
  if (!cases) return workspaceRoutes.root
  if (cases === "open") return `${workspaceRoutes.root}?cases=1`
  return `${workspaceRoutes.root}?cases=${encodeURIComponent(cases)}`
}

export function isWorkspaceHomePath(pathname: string) {
  const path = pathname.split("?")[0]?.split("#")[0] ?? pathname
  return path === workspaceRoutes.root || path === `${workspaceRoutes.root}/`
}

export function workspaceSkillsHref(tab?: "list" | "repo" | "upload") {
  if (!tab || tab === "list") return workspaceRoutes.skills
  return `${workspaceRoutes.skills}?tab=${tab}`
}

export function workspaceDocsHref(section?: "manual" | "plugins" | "release") {
  if (!section) return workspaceRoutes.docs
  return `${workspaceRoutes.docs}#${section}`
}

export function workspaceResourcesHref() {
  return workspaceRoutes.resources
}

export type CapabilityCatalogSelection = {
  category?: CapabilityCategoryParam
  domain?: CapabilityDomainParam
}

export function catalogSelectionFromSearch(search: string): CapabilityCatalogSelection | undefined {
  const params = new URLSearchParams(search)
  const category = params.get("category")
  if (
    category !== "scenario" &&
    category !== "onemodel" &&
    category !== "hpc" &&
    category !== "onedata" &&
    category !== "oneskills" &&
    category !== "submission"
  ) {
    return
  }
  const domain = params.get("domain")
  if (domain === "materials" || domain === "weather" || domain === "fluid" || domain === "bio" || domain === "all") {
    return { category, domain }
  }
  return { category }
}

function capabilityCatalogSearch(selection?: CapabilityCatalogSelection, scenarioId?: string) {
  const params = new URLSearchParams()
  if (scenarioId) params.set("scenario", scenarioId)
  if (selection?.category) {
    params.set("category", selection.category)
    if (selection.domain) params.set("domain", selection.domain)
  }
  return params.toString()
}

export function workspaceCapabilityHref(id: string, selection?: CapabilityCatalogSelection) {
  const base = `${workspaceRoutes.capabilities}/${id}`
  const query = capabilityCatalogSearch(selection)
  return query ? `${base}?${query}` : base
}

export function workspaceCapabilityWizardHref(
  id: string,
  scenarioId?: string,
  selection?: CapabilityCatalogSelection,
) {
  const base = `${workspaceRoutes.capabilities}/${id}/wizard`
  const query = capabilityCatalogSearch(selection, scenarioId)
  return query ? `${base}?${query}` : base
}

/** Restore catalog filters after closing intro/wizard. Prefer URL query over resource.domain. */
export function workspaceCapabilityReturnHref(
  search: string,
  fallback: { category: CapabilityCategoryParam; domain: CapabilityDomainParam },
) {
  const params = new URLSearchParams(search)
  const category = params.get("category")
  if (
    category === "scenario" ||
    category === "onemodel" ||
    category === "hpc" ||
    category === "onedata" ||
    category === "oneskills" ||
    category === "submission"
  ) {
    const domain = params.get("domain")
    if (domain === "materials" || domain === "weather" || domain === "fluid" || domain === "bio" || domain === "all") {
      return workspaceCapabilitiesCategoryHref(category, domain)
    }
    return workspaceCapabilitiesCategoryHref(category)
  }
  return workspaceCapabilitiesCategoryHref(fallback.category, fallback.domain)
}

export function workspaceSessionHref(directory: string, sessionID?: string) {
  const base = `/workspace/${base64Encode(directory)}/session`
  if (!sessionID) return base
  return `${base}/${sessionID}`
}

/** Session chat embedded in the unified workbench main card (not `/code`). */
export function isWorkspaceSessionPath(pathname: string) {
  return /^\/workspace\/[^/]+\/session(?:\/|$)/.test(pathname)
}

/** Capability center catalog and nested intro/wizard routes. */
export function isWorkspaceCapabilitiesPath(pathname: string) {
  const path = pathname.split("?")[0]?.split("#")[0] ?? pathname
  return path === workspaceRoutes.capabilities || path.startsWith(`${workspaceRoutes.capabilities}/`)
}

/** Parse `/workspace/:dir/session/:id?` into route params. */
export function workspaceSessionRouteParams(pathname: string) {
  const pathOnly = pathname.split("?")[0]?.split("#")[0] ?? pathname
  const match = /^\/workspace\/([^/]+)\/session(?:\/([^/?#]+))?/.exec(pathOnly)
  if (!match) return
  return {
    dir: match[1],
    id: match[2],
  }
}

/** Marketing / legacy case domain → representative preset session. */
export const caseDomainSessionIds = {
  earth: "ses_173de5f78ffemATonCgBtx7ECA",
  material: "ses_09102687affe6WEyKzrDV0i5tJ",
  life: "ses_1033535eaffeFd2OKFwlyBG9bl",
  fluid: "ses_10bffedbbffeAnlewduYPOpjBz",
} as const

export type CaseDomainKey = keyof typeof caseDomainSessionIds

export function workspaceCaseDomainHref(domain: CaseDomainKey) {
  return workspaceHomeHref(caseDomainSessionIds[domain])
}

/** Read `?cases=` from workbench home: `1`/`open` expands the list; a session id opens that case. */
export function casesQueryValue(search: string) {
  const raw = new URLSearchParams(search).get("cases")?.trim()
  if (!raw) return
  if (raw === "1" || raw === "open") return "open" as const
  return raw
}

export const legacyWorkbenchRedirects: Record<string, string> = {
  "/home": workspaceRoutes.root,
  "/models": workspaceCapabilitiesCategoryHref("onemodel"),
  "/datasets": workspaceCapabilitiesCategoryHref("onedata"),
  "/apps": workspaceCapabilitiesCategoryHref("hpc"),
  "/skills": workspaceCapabilitiesCategoryHref("oneskills"),
  "/infra": workspaceCapabilitiesHref(),
  "/tasks": workspaceRoutes.root,
  "/data-management": `${workspaceCapabilitiesCategoryHref("onedata")}&onedata=raw`,
  "/apphub": workspaceRoutes.root,
  "/primitives": workspaceCapabilitiesCategoryHref("oneskills"),
  "/research": workspaceRoutes.root,
  "/cases": workspaceHomeHref("open"),
  "/docs": workspaceRoutes.docs,
  "/frameworks": workspaceCapabilitiesHref(),
  "/operators": workspaceCapabilitiesHref(),
}
