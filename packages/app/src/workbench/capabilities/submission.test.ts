import { describe, expect, test } from "bun:test"
import { capabilityCategories } from "./catalog"
import { categoryFromSearch, selectionFromCapabilityLocation, clearStoredCapabilitySelection } from "./selection"
import { workspaceCapabilitiesCategoryHref, catalogSelectionFromSearch, workspaceCapabilityReturnHref } from "../routes"

describe("intelligent submission navigation", () => {
  test("places submission directly after oneskills in every domain", () => {
    for (const domain of [undefined, "materials", "weather", "fluid", "bio"] as const) {
      const categories = capabilityCategories(domain)
      const index = categories.findIndex((category) => category.id === "oneskills")
      expect(categories[index + 1]?.id).toBe("submission")
      expect(categories[index + 1]?.label).toBe("智能投稿")
    }
  })
  test("supports direct links, reload and return navigation", () => {
    clearStoredCapabilitySelection()
    const href = workspaceCapabilitiesCategoryHref("submission", "all")
    const query = href.slice(href.indexOf("?"))
    expect(categoryFromSearch(query)).toBe("submission")
    expect(selectionFromCapabilityLocation("/workspace/capabilities", query)).toEqual({ categoryId: "submission", domainId: "all" })
    expect(catalogSelectionFromSearch(query)).toEqual({ category: "submission", domain: "all" })
    expect(workspaceCapabilityReturnHref(query, { category: "scenario", domain: "materials" })).toBe(href)
  })
})
