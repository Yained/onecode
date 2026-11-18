import { describe, expect, test } from "bun:test"
import {
  workspaceRoutes,
  workspaceCapabilitiesHref,
  workspaceCapabilitiesCategoryHref,
  workspaceCapabilityHref,
  workspaceCapabilityWizardHref,
  workspaceCapabilityReturnHref,
  workspaceHomeHref,
  workspaceDocsHref,
  workspaceResourcesHref,
  workspaceCaseDomainHref,
  workspaceSkillsHref,
  workspaceSessionHref,
  isWorkspaceHomePath,
  isWorkspaceSessionPath,
  isWorkspaceCapabilitiesPath,
  workspaceSessionRouteParams,
  legacyWorkbenchRedirects,
  caseDomainSessionIds,
  oneScienceSourceHref,
} from "./routes"
import { base64Encode } from "@opencode-ai/core/util/encode"

describe("workbench routes", () => {
  test("exposes workspace base paths", () => {
    expect(workspaceRoutes.root).toBe("/workspace")
    expect(workspaceRoutes.capabilities).toBe("/workspace/capabilities")
    expect(workspaceRoutes.skills).toBe("/workspace/skills")
    expect(workspaceRoutes.docs).toBe("/workspace/docs")
    expect(workspaceRoutes.resources).toBe("/workspace/resources")
    expect(workspaceRoutes.session).toBe("/workspace/:dir/session/:id?")
  })

  test("builds capabilities and session hrefs", () => {
    expect(workspaceCapabilitiesHref()).toBe("/workspace/capabilities")
    expect(workspaceCapabilitiesCategoryHref("scenario", "materials")).toBe(
      "/workspace/capabilities?category=scenario&domain=materials",
    )
    expect(workspaceCapabilitiesCategoryHref("oneskills")).toBe("/workspace/capabilities?category=oneskills")
    expect(workspaceCapabilitiesCategoryHref("oneskills", "materials")).toBe(
      "/workspace/capabilities?category=oneskills&domain=materials",
    )
    expect(workspaceCapabilitiesCategoryHref("onemodel")).toBe("/workspace/capabilities?category=onemodel")
    expect(workspaceCapabilitiesCategoryHref("onemodel", "all")).toBe(
      "/workspace/capabilities?category=onemodel&domain=all",
    )
    expect(workspaceCapabilitiesCategoryHref("scenario", "all")).toBe(
      "/workspace/capabilities?category=scenario&domain=all",
    )
    expect(workspaceCapabilitiesCategoryHref("onemodel", "materials")).toBe(
      "/workspace/capabilities?category=onemodel&domain=materials",
    )
    expect(workspaceHomeHref()).toBe("/workspace")
    expect(workspaceHomeHref("open")).toBe("/workspace?cases=1")
    expect(workspaceHomeHref(caseDomainSessionIds.earth)).toBe(`/workspace?cases=${caseDomainSessionIds.earth}`)
    expect(workspaceCaseDomainHref("earth")).toBe(`/workspace?cases=${caseDomainSessionIds.earth}`)
    expect(workspaceDocsHref()).toBe("/workspace/docs")
    expect(workspaceDocsHref("manual")).toBe("/workspace/docs#manual")
    expect(workspaceResourcesHref()).toBe("/workspace/resources")
    expect(workspaceCapabilityHref("mace")).toBe("/workspace/capabilities/mace")
    expect(workspaceCapabilityHref("fengwu", { category: "onemodel", domain: "all" })).toBe(
      "/workspace/capabilities/fengwu?category=onemodel&domain=all",
    )
    expect(workspaceCapabilityHref("mace", { category: "onemodel", domain: "materials" })).toBe(
      "/workspace/capabilities/mace?category=onemodel&domain=materials",
    )
    expect(workspaceCapabilityWizardHref("fengwu", undefined, { category: "onemodel", domain: "all" })).toBe(
      "/workspace/capabilities/fengwu/wizard?category=onemodel&domain=all",
    )
    expect(workspaceCapabilityWizardHref("mace", "train", { category: "onemodel", domain: "materials" })).toBe(
      "/workspace/capabilities/mace/wizard?scenario=train&category=onemodel&domain=materials",
    )
    expect(workspaceCapabilityReturnHref("?category=onemodel&domain=all", { category: "onemodel", domain: "weather" })).toBe(
      "/workspace/capabilities?category=onemodel&domain=all",
    )
    expect(
      workspaceCapabilityReturnHref("?category=onemodel&domain=materials", {
        category: "onemodel",
        domain: "weather",
      }),
    ).toBe("/workspace/capabilities?category=onemodel&domain=materials")
    expect(workspaceCapabilityReturnHref("", { category: "onemodel", domain: "weather" })).toBe(
      "/workspace/capabilities?category=onemodel&domain=weather",
    )
    expect(workspaceSkillsHref()).toBe("/workspace/skills")
    expect(workspaceSkillsHref("upload")).toBe("/workspace/skills?tab=upload")
    expect(workspaceSessionHref("/data/u/demo")).toBe(`/workspace/${base64Encode("/data/u/demo")}/session`)
  })

  test("detects workspace session embed paths", () => {
    const slug = base64Encode("/data/u/demo")
    expect(isWorkspaceSessionPath(`/workspace/${slug}/session`)).toBe(true)
    expect(isWorkspaceSessionPath(`/workspace/${slug}/session/ses_1`)).toBe(true)
    expect(isWorkspaceHomePath("/workspace")).toBe(true)
    expect(isWorkspaceHomePath("/workspace/")).toBe(true)
    expect(isWorkspaceHomePath("/workspace/capabilities")).toBe(false)
    expect(isWorkspaceSessionPath("/workspace")).toBe(false)
    expect(isWorkspaceSessionPath("/workspace/capabilities")).toBe(false)
    expect(isWorkspaceSessionPath(`/code/${slug}/session/ses_1`)).toBe(false)
  })

  test("detects capability center paths", () => {
    expect(isWorkspaceCapabilitiesPath("/workspace/capabilities")).toBe(true)
    expect(isWorkspaceCapabilitiesPath("/workspace/capabilities/")).toBe(true)
    expect(isWorkspaceCapabilitiesPath("/workspace/capabilities?category=scenario")).toBe(true)
    expect(isWorkspaceCapabilitiesPath("/workspace/capabilities/mace/wizard")).toBe(true)
    expect(isWorkspaceCapabilitiesPath("/workspace")).toBe(false)
    expect(isWorkspaceCapabilitiesPath("/workspace/skills")).toBe(false)
  })

  test("parses workspace session route params", () => {
    const slug = base64Encode("/data/u/demo")
    const bare = workspaceSessionRouteParams(`/workspace/${slug}/session`)
    expect(bare?.dir).toBe(slug)
    expect(bare?.id).toBeUndefined()
    expect(workspaceSessionRouteParams(`/workspace/${slug}/session/ses_1`)).toEqual({ dir: slug, id: "ses_1" })
    expect(workspaceSessionRouteParams("/workspace/capabilities")).toBeUndefined()
  })

  test("exposes OneScience source repository href", () => {
    expect(oneScienceSourceHref).toBe("https://gitee.com/onescience-ai/onescience")
  })

  test("maps legacy workbench paths to category-aware targets", () => {
    expect(legacyWorkbenchRedirects["/home"]).toBe("/workspace")
    expect(legacyWorkbenchRedirects["/models"]).toBe("/workspace/capabilities?category=onemodel")
    expect(legacyWorkbenchRedirects["/datasets"]).toBe("/workspace/capabilities?category=onedata")
    expect(legacyWorkbenchRedirects["/apps"]).toBe("/workspace/capabilities?category=hpc")
    expect(legacyWorkbenchRedirects["/skills"]).toBe("/workspace/capabilities?category=oneskills")
    expect(legacyWorkbenchRedirects["/frameworks"]).toBe("/workspace/capabilities")
    expect(legacyWorkbenchRedirects["/operators"]).toBe("/workspace/capabilities")
    expect(legacyWorkbenchRedirects["/infra"]).toBe("/workspace/capabilities")
    expect(legacyWorkbenchRedirects["/docs"]).toBe("/workspace/docs")
    expect(legacyWorkbenchRedirects["/cases"]).toBe("/workspace?cases=1")
    expect(legacyWorkbenchRedirects["/research"]).toBe("/workspace")
    expect(legacyWorkbenchRedirects["/data-management"]).toBe("/workspace/capabilities?category=onedata&onedata=raw")
  })
})
