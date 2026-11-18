import { describe, expect, test } from "bun:test"

describe("prompt input prompt helper", () => {
  test("does not abort a running turn on Escape during IME or follow-up draft", async () => {
    const source = await Bun.file(new URL("./prompt-input.tsx", import.meta.url)).text()
    const escape = source.indexOf("IME uses Escape to cancel candidates")
    expect(escape).toBeGreaterThan(-1)
    expect(source.slice(escape)).toContain("if (isImeComposing(event)) return")
    expect(source.slice(escape)).toContain("Same gate as the stop button")
    expect(source.slice(escape, escape + 800)).toContain("if (stopping()) {")
  })

  test("keeps prompt helper off the dock tray", async () => {
    const source = await Bun.file(new URL("./prompt-input.tsx", import.meta.url)).text()
    const agent = source.indexOf('data-component="prompt-agent-control"')
    const dockTray = source.indexOf("<DockTray")
    const dockTrayEnd = source.indexOf("</DockTray>")

    expect(source).not.toContain('data-component="prompt-helper-control"')
    expect(source).not.toContain("科研提示词助手")
    expect(source).not.toContain("PromptHelperDialog")
    expect(source).toContain("shadow-none")
    expect(source).toContain('data-component="prompt-composer"')
    expect(source).toContain('"box-shadow": "none"')
    expect(source).not.toContain("focus-within:shadow-xs-border")
    expect(source).toContain('attach="none"')
    expect(agent).toBeGreaterThan(dockTray)
    expect(agent).toBeLessThan(dockTrayEnd)
  })

  test("uses the optimized prompt helper dialog layout", async () => {
    const source = await Bun.file(new URL("./prompt-helper-dialog.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()

    expect(source).toContain("os-prompt-helper-layout")
    expect(source).toContain("os-prompt-helper-panel")
    expect(source).toContain("os-prompt-helper-content")
    expect(style).toContain(".os-prompt-helper-layout")
    expect(style).toContain(".os-prompt-helper-content")
  })

  test("shows welcome hero on the new code session screen", async () => {
    const source = await Bun.file(new URL("./session/session-new-view.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()

    expect(source).toContain("os-client-chat-hero")
    expect(source).toContain("全流程科研模型生成平台")
    expect(source).toContain("/assets/onescience/onescience-logo.png")
    expect(source).not.toContain("有什么可以帮你的？")
    expect(source).not.toContain("NewSessionTaskHelper")
    expect(source).not.toContain("SkillTaskProfileBoxes")
    expect(style).toContain(".os-code-embed .os-client-chat-hero .os-client-logo")
    expect(style).toContain("html[data-color-scheme=\"dark\"] .os-code-embed")
    expect(style).toContain("--os-code-send: #5f5f5f")
    expect(style).toContain("--os-code-send-disabled: #9a9a9a")
  })

  test("keeps task-profile skeleton placeholders visible instead of empty bordered cards", async () => {
    const boxes = await Bun.file(new URL("./session/skill-task-profile-boxes.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()
    const skeleton = boxes.slice(
      boxes.indexOf("function SkillTaskProfileBoxesSkeleton"),
      boxes.indexOf("function SkillTaskProfileBoxesFallback"),
    )

    expect(skeleton).not.toContain("os-resource-skeleton")
    expect(skeleton).toContain("os-skeleton-line")
    expect(style).toContain(".os-skill-task-groups[data-layout=\"chatgpt-boxes\"] .os-skill-task-skeleton-label")
    expect(style).toContain(".os-skill-task-groups[data-layout=\"chatgpt-boxes\"] .os-skill-task-skeleton-chip")
  })

  test("keeps new session hero compact without project metadata", async () => {
    const source = await Bun.file(new URL("./session/session-new-view.tsx", import.meta.url)).text()

    expect(source).not.toContain('Icon name="branch"')
    expect(source).not.toContain("session.new.lastModified")
    expect(source).not.toContain("os-new-session-metadata")
    expect(source).not.toContain("getFilename(projectRoot())")
    expect(source).toContain("os-client-chat-hero")
    expect(source).toContain("os-client-logo")
    expect(source.indexOf("os-client-logo")).toBeLessThan(source.indexOf("全流程科研模型生成平台"))
  })

  test("uses short card descriptions for all prompt helper entries", async () => {
    const source = await Bun.file(new URL("../pages/onescience.tsx", import.meta.url)).text()

    expect(source).toContain("taskProfileCardDescriptions")
    expect(source).toContain('"model-development": "构建或改造科学模型。"')
    expect(source).toContain("taskProfileCardDescriptions[item.id as keyof typeof taskProfileCardDescriptions] ?? item.description")
  })

  test("renders the task creation dialog at the page level", async () => {
    const source = await Bun.file(new URL("./onescience/TaskCreateDialog.tsx", import.meta.url)).text()

    expect(source).toContain('import { Portal } from "solid-js/web"')
    expect(source).toContain("<Portal>")
    expect(source.indexOf("<Portal>")).toBeLessThan(source.indexOf('<div class="os-modal-backdrop"'))
  })

  test("uses a dedicated operator performance optimization form", async () => {
    const source = await Bun.file(new URL("./onescience/TaskCreateDialog.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()

    expect(source).not.toContain("operatorOptimizationScenarios")
    expect(source).not.toContain("优化场景")
    expect(source).toContain("优化 Kernel")
    expect(source).toContain("端到端性能")
    expect(source).toContain("Benchmark耗时")
    expect(source).toContain("代码来源")
    expect(source).toContain("允许优化范围")
    expect(source).not.toContain("当前优化思路")
    expect(source).not.toContain("瓶颈建议")
    expect(source).toContain("优化策略")
    expect(source).toContain("输出内容")
    expect(source).toContain("请作为 GPU / AI 加速 Kernel性能优化专家")
    expect(source).toContain("请自动检测并补充硬件环境与软件环境")
    expect(style).toContain(".os-task-radio-grid")
    expect(style).toContain(".os-task-checkbox-grid")
  })

  test("keeps vertical breathing room around task quick selects", async () => {
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()

    expect(style).toContain(".os-task-create-dialog .os-task-quick-select")
    expect(style).toContain("padding-block: 0.18rem")
  })

  test("keeps only task quick select titles bold in the input dialog", async () => {
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()

    expect(style).toContain(".os-task-create-dialog .os-task-plan-preview strong")
    expect(style).toContain("font-weight: 400;")
    expect(style).toContain(".os-task-create-dialog .os-task-quick-select span")
    expect(style).toContain("font-weight: 780;")
  })
})
