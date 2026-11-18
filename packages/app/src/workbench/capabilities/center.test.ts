import { beforeEach, describe, expect, test } from "bun:test"
import { clearStoredCapabilitySelection, selectionFromCapabilityLocation } from "./selection"

describe("capability center page", () => {
  beforeEach(() => {
    clearStoredCapabilitySelection()
  })
  test("uses scenario tab, resource grids, onedata panel, and oneskills panel", async () => {
    const center = await Bun.file(new URL("./center.tsx", import.meta.url)).text()
    const panel = await Bun.file(new URL("./oneskills-panel.tsx", import.meta.url)).text()
    const overlay = await Bun.file(new URL("./scenario-wizard-overlay.tsx", import.meta.url)).text()
    const wizard = await Bun.file(new URL("./wizard.tsx", import.meta.url)).text()
    const css = await Bun.file(new URL("../../index.css", import.meta.url)).text()

    expect(center).toContain("ScenarioWizardOverlay")
    expect(center).toContain('id: "scenario"')
    expect(center).toContain("os-client-capability-scenario-grid")
    expect(center).toContain("os-client-capability-scenario-search")
    expect(center).toContain("os-client-capability-scenario-card-action")
    expect(center).not.toContain("os-client-capability-scenario-card-use")
    expect(center).not.toContain("os-client-capability-scenario-card-footer")
    expect(center).toContain("CapabilityPager")
    expect(center).toContain("paginate(")
    expect(center).toContain("CAPABILITY_PAGE_SIZE_SCENARIO")
    expect(center).toContain("CAPABILITY_PAGE_SIZE_RESOURCE")
    expect(center).toContain('setQuery("")')
    expect(center).toContain('scenarioQuery: ""')
    expect(center).toContain("searchDomainScenarios")
    expect(center).toContain("CapabilityResourcePanel")
    expect(center).toContain("CapabilityCatalogList")
    expect(center).toContain("os-client-capability-view-switch")
    expect(center).toContain('label: "列表"')
    expect(center).toContain("workspaceCapabilityWizardHref")
    expect(center).toContain("CapabilityOneSkillsPanel")
    expect(center).toContain("CapabilityOnedataPanel")
    expect(center).toContain('"onedata"')
    expect(center).toContain('"oneskills"')
    expect(center).toContain("writeStoredCapabilitySelection")
    expect(center).toContain("OneSkills 原语跨领域通用，不区分材料 / 气象 / 流体 / 生信")
    expect(center).toContain("当前范围：")
    expect(center).toContain('state.categoryId !== "oneskills"')
    expect(center).not.toContain('new Set<CapabilityCategoryId>(["oneskills"])')
    expect(center).not.toContain("domainIndependentCategories")
    expect(center).toContain("useLocation")
    expect(center).toContain("selectionFromCapabilityLocation")
    expect(center).toContain("workspaceCapabilitiesCategoryHref")
    expect(center).toContain("切换领域后，下方模型、HPC 软件与数据集内容同步刷新")
    expect(center).toContain("is-unavailable")
    expect(center).toContain("暂无 OneScience 源码或魔搭映射")
    expect(center).toContain("isCapabilityResourceAvailable")
    expect(center).toContain("isCapabilityResourceInstallable")
    expect(center).toContain("disabled={!installable()}")
    expect(center).toContain('title={installable() ? undefined : "暂无魔搭安装包"}')
    expect(center).not.toContain("暂无魔搭包")
    expect(center).toContain('id: "all"')
    expect(center).toContain('label: "全部"')
    expect(center).not.toContain("CapFilterSelect")
    expect(center).not.toContain("os-client-capability-filter-badge")
    expect(center).not.toContain("可组合使用 onemodel")
    expect(center).not.toContain('"oneinfra"')
    expect(center).not.toContain("CapabilityEmptyPanel")
    expect(center).not.toContain("onedata 卡片即将上线，敬请期待。")
    expect(overlay).toContain("本步 Prompt")
    expect(overlay).toContain("创建任务并自动逐步执行")
    expect(overlay).toContain("submitWithGapsAllowed")
    expect(overlay).toContain("由智能体追问")
    expect(overlay).not.toContain("ScenarioMissingParamsDialog")
    expect(overlay).not.toContain("请补充必填参数")
    expect(overlay).toContain("相关论文")
    expect(overlay).toContain("related_papers")
    expect(overlay).toContain("RELATED_PAPERS_PREVIEW")
    expect(overlay).toContain("展开其余")
    expect(overlay).toContain("is-expanded")
    expect(overlay).toContain('target="_blank"')
    expect(css).toContain(".os-client-capability-wizard-papers ul.is-expanded")
    expect(css).toContain("overflow-y: auto")
    expect(wizard).toContain("userScenariosForResource")
    expect(wizard).toContain("完整工作流场景 · {catalogUserScenarios().length}")
    expect(wizard).toContain("os-client-capability-wizard-scenario-group")
    expect(wizard).toContain("ScenarioWizardOverlay")
    expect(panel).toContain("upgradeOneSkills")
    expect(panel).toContain("formatOneSkillsUpgradeError")
    expect(panel).toContain("更新 OneSkills")
    expect(panel).toContain("更新中...")
    expect(panel).toContain("SKILL_LAYER_PREVIEW_COUNT")
    expect(panel).toContain("os-client-capability-oneskills-top-row")
    expect(panel).toContain("os-client-capability-page-grid")
    expect(panel).toContain('variant="workbench"')
    expect(panel).toContain("requirePersonalSpace")
    expect(panel).toContain('workspaceCapabilitiesCategoryHref("oneskills", domain)')
    expect(center).toContain("os-client-capability-catalog")
    expect(center).toContain("按名称、简介或标签筛选")
    expect(center).toContain("CapabilityCardGrid")
  })

  test("defaults to scenario category and infers resource paths", () => {
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "")).toEqual({
      categoryId: "scenario",
      domainId: "all",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=scenario&domain=materials")).toEqual({
      categoryId: "scenario",
      domainId: "materials",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities/lammps/wizard", "")).toEqual({
      categoryId: "hpc",
      domainId: "materials",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities/mace/wizard", "")).toEqual({
      categoryId: "onemodel",
      domainId: "materials",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=oneskills")).toEqual({
      categoryId: "oneskills",
      domainId: "all",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=onedata")).toEqual({
      categoryId: "onedata",
      domainId: "all",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=onedata&domain=materials")).toEqual({
      categoryId: "onedata",
      domainId: "materials",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=hpc&domain=materials")).toEqual({
      categoryId: "hpc",
      domainId: "materials",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=onemodel")).toEqual({
      categoryId: "onemodel",
      domainId: "all",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=scenario&domain=all")).toEqual({
      categoryId: "scenario",
      domainId: "all",
    })
    expect(selectionFromCapabilityLocation("/workspace/capabilities", "?category=scenario")).toEqual({
      categoryId: "scenario",
      domainId: "all",
    })
    // Nested intro/wizard with catalog query must keep the user's domain tab (e.g. 全部),
    // not jump to the resource's own domain.
    expect(selectionFromCapabilityLocation("/workspace/capabilities/fengwu", "?category=onemodel")).toEqual({
      categoryId: "onemodel",
      domainId: "all",
    })
    expect(
      selectionFromCapabilityLocation(
        "/workspace/capabilities/fengwu/wizard",
        "?category=onemodel&domain=materials",
      ),
    ).toEqual({
      categoryId: "onemodel",
      domainId: "materials",
    })
  })

  test("keeps domain tab when opening nested intro/wizard without catalog query", async () => {
    const center = await Bun.file(new URL("./center.tsx", import.meta.url)).text()
    expect(center).toContain("preserveDomainOnNestedCapability")
    expect(center).toContain("workspaceCapabilityHref(props.item.id")
  })

  test("serializeDomain keeps 全部 as explicit domain=all for scenario", async () => {
    const { workspaceCapabilitiesCategoryHref } = await import("@/workbench/routes")
    expect(workspaceCapabilitiesCategoryHref("scenario", "all")).toBe(
      "/workspace/capabilities?category=scenario&domain=all",
    )
    expect(workspaceCapabilitiesCategoryHref("onemodel", "all")).toBe(
      "/workspace/capabilities?category=onemodel&domain=all",
    )
    expect(workspaceCapabilitiesCategoryHref("oneskills", "all")).toBe(
      "/workspace/capabilities?category=oneskills&domain=all",
    )
  })
})
