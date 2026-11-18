import { describe, expect, test } from "bun:test"

describe("capability wizard intro back", () => {
  test("wizard links back to capability intro with category labels", async () => {
    const source = await Bun.file(new URL("./wizard.tsx", import.meta.url)).text()
    expect(source).toContain('if (category === "hpc") return "软件介绍"')
    expect(source).toContain('return "模型介绍"')
    expect(source).toContain("workspaceCapabilityHref(params.id ?? \"\", catalog())")
    expect(source).toContain("workspaceCapabilityReturnHref")
    expect(source).toContain("os-client-capability-wizard-intro-back")
    expect(source).toContain("introBackLabel(item().category)")
  })

  test("wizard title is centered use-xxx research task copy", async () => {
    const source = await Bun.file(new URL("./wizard.tsx", import.meta.url)).text()
    expect(source).toContain("使用 ${name} 开始科研任务")
    expect(source).toContain("wizardTitle(item().name)")
    expect(source).toContain("os-client-capability-wizard-head-title")
    expect(source).not.toContain("模型能力向导")
    expect(source).not.toContain("软件能力向导")
  })

  test("wizard three columns expose config, expected outputs, and prompt", async () => {
    const source = await Bun.file(new URL("./wizard.tsx", import.meta.url)).text()
    expect(source).toContain("当前能力配置")
    expect(source).toContain("该能力需要什么数据")
    expect(source).toContain("预计产出")
    expect(source).toContain("起始任务")
    expect(source).toContain("创建任务")
    expect(source).toContain("os-client-capability-wizard-footer")
    expect(source).toContain("expectedOutputs")
    expect(source).toContain("capabilitySummary")
    expect(source).toContain("完整工作流场景 · {catalogUserScenarios().length}")
    expect(source).toContain("os-client-capability-wizard-scenario-group")
    expect(source).not.toContain("os-client-capability-wizard-right-actions")
    expect(source).not.toContain("os-client-capability-wizard-expected")
  })

  test("left-rail linked scenarios stay in a scrollable list with count", async () => {
    const css = await Bun.file(new URL("../../index.css", import.meta.url)).text()
    expect(css).toContain(".os-client-capability-wizard-scenarios {")
    expect(css).toContain("max-height: min(28rem, 55vh)")
    expect(css).toContain("overflow-y: auto")
    expect(css).toContain(".os-client-capability-wizard-scenario-group > span")
    expect(css).toContain("position: sticky")
    expect(css).toContain("-webkit-line-clamp: 2")
  })

  test("middle-column field edits sync prompt on the right", async () => {
    const source = await Bun.file(new URL("./wizard.tsx", import.meta.url)).text()
    expect(source).toContain("promptForScenario(current, values)")
    expect(source).toMatch(/setFieldValue[\s\S]*promptForScenario/)
  })
})
