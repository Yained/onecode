import { describe, expect, test } from "bun:test"
import { buildInstallHandoff } from "./install"

describe("capability install", () => {
  test("builds install handoff prompt from catalog", () => {
    const { banner, prompt } = buildInstallHandoff("mace")
    expect(banner).toContain("MACE")
    expect(prompt).toContain("环境配置")
    expect(prompt).toContain("modelscope download --model OneScience/MACE")
  })

  test("injects modelscope download into enriched install prompts", () => {
    const { prompt } = buildInstallHandoff("fno")
    expect(prompt).toContain("modelscope download --model OneScience/FNO")
    expect(prompt).toContain("【从魔搭下载模型】")
  })

  test("rejects install when modelscope mapping is missing", () => {
    expect(() => buildInstallHandoff("alphafold")).toThrow(/not installable/)
  })
})
