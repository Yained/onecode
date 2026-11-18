import {
  getCapabilityResource,
  type CapabilityCategoryId,
  type CapabilityDomain,
} from "./catalog"
import { workspaceRoutes } from "@/workbench/routes"

export type CapabilityDomainSelection = CapabilityDomain | "all"

export type CapabilityCatalogSelectionState = {
  categoryId: CapabilityCategoryId
  domainId: CapabilityDomainSelection
}

const STORAGE_KEY = "os-capability-catalog-selection"

export const defaultCapabilitySelection: CapabilityCatalogSelectionState = {
  categoryId: "scenario",
  domainId: "all",
}

function isCategory(value: unknown): value is CapabilityCategoryId {
  return value === "scenario" || value === "onemodel" || value === "hpc" || value === "onedata" || value === "oneskills" || value === "submission"
}

function isDomain(value: unknown): value is CapabilityDomainSelection {
  return value === "all" || value === "materials" || value === "weather" || value === "fluid" || value === "bio"
}

export function categoryFromSearch(search: string): CapabilityCategoryId | undefined {
  const raw = new URLSearchParams(search).get("category")
  return isCategory(raw) ? raw : undefined
}

export function domainFromSearch(search: string): CapabilityDomainSelection | undefined {
  const raw = new URLSearchParams(search).get("domain")
  return isDomain(raw) ? raw : undefined
}

export function readStoredCapabilitySelection(): CapabilityCatalogSelectionState | undefined {
  try {
    if (typeof localStorage === "undefined") return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<CapabilityCatalogSelectionState>
    if (!isCategory(parsed.categoryId) || !isDomain(parsed.domainId)) return
    return { categoryId: parsed.categoryId, domainId: parsed.domainId }
  } catch {
    return
  }
}

export function writeStoredCapabilitySelection(selection: CapabilityCatalogSelectionState) {
  try {
    if (typeof localStorage === "undefined") return
    if (!isCategory(selection.categoryId) || !isDomain(selection.domainId)) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function clearStoredCapabilitySelection() {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore.
  }
}

/** Sidebar and empty-catalog landings restore the last domain/category tab. */
export function capabilityCatalogHref() {
  const stored = readStoredCapabilitySelection() ?? defaultCapabilitySelection
  const params = new URLSearchParams({
    category: stored.categoryId,
    domain: stored.domainId,
  })
  return `${workspaceRoutes.capabilities}?${params}`
}

/** Prefer ?category=; on intro/wizard paths infer from the capability resource (e.g. lammps → hpc). */
export function selectionFromCapabilityLocation(pathname: string, search: string): CapabilityCatalogSelectionState {
  const category = categoryFromSearch(search)
  const domain = domainFromSearch(search)
  const stored = readStoredCapabilitySelection()
  if (category) {
    if (domain) return { categoryId: category, domainId: domain }
    // oneskills used to omit domain=; keep the user's last domain instead of jumping to 全部.
    if (category === "oneskills" || category === "submission") {
      return { categoryId: category, domainId: stored?.domainId ?? "all" }
    }
    // Missing domain on other tabs means the all-domains catalog.
    return { categoryId: category, domainId: "all" }
  }
  const match = new RegExp(`^${workspaceRoutes.capabilities}/([^/]+)`).exec(pathname)
  const resource = match?.[1] ? getCapabilityResource(match[1]) : undefined
  if (resource) {
    return { categoryId: resource.category as CapabilityCategoryId, domainId: domain ?? resource.domain }
  }
  return stored ?? defaultCapabilitySelection
}
