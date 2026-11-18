import { describe, expect, test } from "bun:test"
import { capabilityCategories, getCapabilityResource, listCapabilityDomains } from "./catalog"
import { modelResourceSeedCount } from "./model-resources"

describe("capability catalog", () => {
  test("exposes scenario, onemodel, hpc, onedata, and oneskills categories", () => {
    const cats = capabilityCategories("materials")
    expect(cats.map((c) => c.id)).toEqual(["scenario", "onemodel", "hpc", "onedata", "oneskills", "submission"])
    expect(cats.find((c) => c.id === "scenario")?.items).toEqual([])
    expect(cats.find((c) => c.id === "onemodel")?.items.map((i) => i.id)).toContain("mace")
    expect(cats.find((c) => c.id === "onemodel")?.items.map((i) => i.id)).toContain("deepmd")
    expect(cats.find((c) => c.id === "onemodel")?.items.map((i) => i.id)).toContain("matris")
    expect(cats.find((c) => c.id === "hpc")?.items.map((i) => i.id)).toEqual(["lammps", "vasp"])
    expect(cats.find((c) => c.id === "onedata")?.items).toEqual([])
    expect(cats.find((c) => c.id === "oneskills")?.items).toEqual([])
  })

  test("onemodel catalog is driven by OneHub model resource seeds", () => {
    const all = capabilityCategories().find((c) => c.id === "onemodel")?.items ?? []
    expect(all.filter((item) => item.resourceId?.startsWith("seed-models-")).length).toBe(130)
    expect(all.some((item) => item.available === false)).toBe(true)
    expect(all.some((item) => item.available !== false)).toBe(true)
    expect(all.some((item) => item.installable === true)).toBe(true)
    const installableFirst = all.findIndex((item) => item.installable)
    const sourceOnlyFirst = all.findIndex((item) => item.available !== false && !item.installable)
    const unavailableFirst = all.findIndex((item) => item.available === false)
    expect(installableFirst).toBeGreaterThanOrEqual(0)
    if (sourceOnlyFirst >= 0) expect(sourceOnlyFirst).toBeGreaterThan(installableFirst)
    expect(unavailableFirst).toBeGreaterThan(installableFirst)
  })

  test("source-covered models stay interactive; install requires modelscope map", () => {
    const alphafold = getCapabilityResource("alphafold")
    expect(alphafold?.available).not.toBe(false)
    expect(alphafold?.installable).toBe(false)
    expect(alphafold?.docsHref).toContain("gitee.com/onescience-ai/onescience")

    const fno = getCapabilityResource("fno")
    expect(fno?.available).not.toBe(false)
    expect(fno?.installable).toBe(true)

    const mace = getCapabilityResource("mace")
    expect(mace?.available).not.toBe(false)
    expect(mace?.installable).toBe(true)

    const corrdiff = getCapabilityResource("seed-models-modelhub-corrdiff")
    expect(corrdiff?.available).not.toBe(false)
    expect(corrdiff?.installable).toBe(true)
    expect(corrdiff?.docsHref).toBe("https://modelscope.cn/models/OneScience/CorrDiff")

    const gfno = getCapabilityResource("gfno")
    expect(gfno?.available).not.toBe(false)
    expect(gfno?.installable).toBe(true)
    expect(gfno?.resourceId).toBe("seed-models-fluid-gfno")
    expect(gfno?.name).toBe("GFNO")

    const tace = getCapabilityResource("seed-models-material-tace")
    expect(tace?.available).toBe(false)
    expect(tace?.installable).toBe(false)
  })

  test("filters onemodels by domain", () => {
    expect(listCapabilityDomains()).toEqual(["materials", "weather", "fluid", "bio"])
    const weather = capabilityCategories("weather").find((c) => c.id === "onemodel")?.items.map((i) => i.id) ?? []
    expect(weather).toContain("fengwu")
    expect(weather).toContain("fourcastnet")
    expect(weather).toContain("fuxi")
    expect(weather).toContain("graphcast")
    expect(weather).toContain("pangu")
    expect(weather).toContain("xihe")
    expect(capabilityCategories("fluid").find((c) => c.id === "onemodel")?.items.length).toBeGreaterThanOrEqual(23)
    expect(capabilityCategories("bio").find((c) => c.id === "onemodel")?.items.length).toBeGreaterThanOrEqual(18)
    expect(capabilityCategories("materials").find((c) => c.id === "onemodel")?.items.length).toBeGreaterThanOrEqual(5)
    expect(capabilityCategories("weather").find((c) => c.id === "hpc")?.items).toEqual([])
  })

  test("enriched models keep distinct scenario shortcuts", () => {
    expect(getCapabilityResource("matris")?.scenarios.slice(0, 3).map((s) => s.title)).toEqual([
      "预测能量力应力",
      "评估原子磁矩",
      "ASE 结构弛豫",
    ])
    expect(getCapabilityResource("uma_escn_md")?.scenarios.slice(0, 3).map((s) => s.title)).toEqual([
      "带条件的 EFS 推理",
      "微调 eSCNMD backbone",
      "评估能量力应力误差",
    ])
    expect(getCapabilityResource("fengwu")?.scenarios.slice(0, 3).map((s) => s.title)).toEqual([
      "整理六分支输入",
      "中期多变量预报",
      "评估跨变量技巧",
    ])
    expect(getCapabilityResource("alphafold")?.scenarios.slice(0, 3).map((s) => s.title)).toEqual([
      "RunModel 单体折叠",
      "Multimer 复合物推理",
      "MSA 管线特征构建",
    ])
    expect(getCapabilityResource("fno")?.scenarios.slice(0, 3).map((s) => s.title)).toEqual([
      "Fourier 神经算子基线训练",
      "规则网格低频场代理",
      "FNO 稳态/动态场预测",
    ])
  })

  test("each resource has intro, install, docs, and at least three scenarios", () => {
    for (const domain of listCapabilityDomains()) {
      for (const category of capabilityCategories(domain)) {
        for (const item of category.items) {
          expect(item.domain).toBe(domain)
          expect(item.intro.title).toBeTruthy()
          expect(item.docsHref.includes("gitee.com/onescience-ai/onescience") || item.docsHref.includes("modelscope.cn/models/")).toBe(true)
          expect(item.install.prompt).toContain(item.name)
          expect(item.scenarios.length).toBeGreaterThanOrEqual(3)
          for (const scenario of item.scenarios) {
            expect(scenario.fields.length).toBeGreaterThan(0)
            expect(scenario.fields.every((field) => field.id && field.label)).toBe(true)
            expect(scenario.promptTemplate).toContain("{{system}}")
            expect(scenario.promptTemplate).toContain("{{inputData}}")
            expect(scenario.expectedOutputs.length).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  test("alphafold3 fourth wizard scenario exposes form fields for sidebar selection", () => {
    const scenario = getCapabilityResource("alphafold3")?.scenarios.at(3)
    expect(scenario?.id).toBe("alphafold3-ccd")
    expect(scenario?.title).toBe("MSA/CCD 管线联调")
    expect(scenario?.fields.length).toBeGreaterThan(0)
    expect(scenario?.fields.map((field) => field.id)).toEqual(["system", "inputData", "goal", "environment"])
  })

  test("maps phase-1 resources to domain example paths", () => {
    expect(getCapabilityResource("mace")?.docsHref).toBe(
      "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/mace",
    )
    expect(getCapabilityResource("deepmd")?.docsHref).toBe(
      "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/dp",
    )
    expect(getCapabilityResource("lammps")?.docsHref).toBe(
      "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/tools/lmp",
    )
    expect(getCapabilityResource("vasp")?.docsHref).toBe(
      "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/tools/vasp",
    )
    expect(getCapabilityResource("pangu")?.docsHref).toBe(
      "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/pangu_weather",
    )
    expect(getCapabilityResource("alphafold")?.docsHref).toBe(
      "https://gitee.com/onescience-ai/onescience/tree/main/examples/biosciences/alphafold",
    )
    expect(getCapabilityResource("fno")?.docsHref).toBe(
      "https://gitee.com/onescience-ai/onescience/tree/main/src/onescience/models/cfd_benchmark/FNO.py",
    )
  })

  test("resolves seed resource ids to capability resources", () => {
    expect(getCapabilityResource("seed-models-modelhub-fengwu")?.id).toBe("fengwu")
    expect(getCapabilityResource("seed-models-material")?.id).toBe("mace")
  })

  test("deepmd intro scenarios match the three-card shortcut layout", () => {
    expect(getCapabilityResource("deepmd")?.scenarios.map((item) => item.id)).toEqual([
      "deepmd-convert",
      "deepmd-train",
      "deepmd-lammps",
    ])
    expect(getCapabilityResource("deepmd")?.scenarios.map((item) => item.title)).toEqual([
      "转换 DeepMD 数据",
      "训练 Deep Potential",
      "部署到 LAMMPS",
    ])
  })

  test("lammps intro scenarios match the three-card shortcut layout", () => {
    expect(getCapabilityResource("lammps")?.scenarios.map((item) => item.id)).toEqual([
      "lammps-mace-md",
      "lammps-classical-md",
      "lammps-postprocess",
    ])
    expect(getCapabilityResource("lammps")?.scenarios.map((item) => item.title)).toEqual([
      "MACE 力场 MD",
      "经典力场 MD",
      "轨迹后处理",
    ])
  })

  test("vasp intro scenarios match the three-card shortcut layout", () => {
    expect(getCapabilityResource("vasp")?.scenarios.map((item) => item.id)).toEqual([
      "vasp-relax",
      "vasp-aimd",
      "vasp-postprocess",
    ])
    expect(getCapabilityResource("vasp")?.scenarios.map((item) => item.title)).toEqual([
      "结构优化计算",
      "AIMD 数据生成",
      "结果检查与后处理",
    ])
  })

  test("mace wizard scenarios cover real matchem usage flows", () => {
    const mace = getCapabilityResource("mace")
    expect(mace?.scenarios.map((item) => item.id)).toEqual([
      "mace-train",
      "mace-evaluate",
      "mace-lammps",
      "mace-prepare-data",
    ])
    expect(mace?.scenarios.map((item) => item.title)).toEqual([
      "训练机器学习势",
      "评估势函数精度",
      "准备 LAMMPS 分子动力学",
      "整理 AIMD 训练数据",
    ])
    for (const scenario of mace?.scenarios ?? []) {
      expect(scenario.expectedOutputs.length).toBeGreaterThan(0)
      expect(scenario.requiredData?.length).toBeGreaterThan(0)
      expect(scenario.capabilitySummary.current).toBeTruthy()
      expect(scenario.promptTemplate).toContain("{{system}}")
      expect(scenario.promptTemplate).toContain("{{inputData}}")
    }
  })

  test("wizard fields prefill non-empty defaults for onemodel and hpc", () => {
    const fieldDefault = (field: { default?: string; placeholder?: string }) => {
      if (field.default?.trim()) return field.default
      return field.placeholder?.replace(/^例如[：:]\s*/, "").trim() ?? ""
    }
    for (const domain of listCapabilityDomains()) {
      for (const category of capabilityCategories(domain)) {
        if (category.id !== "onemodel" && category.id !== "hpc") continue
        for (const item of category.items) {
          for (const scenario of item.scenarios) {
            expect(scenario.fields.every((field) => fieldDefault(field).length > 0)).toBe(true)
          }
        }
      }
    }
    const train = getCapabilityResource("mace")?.scenarios.find((item) => item.id === "mace-train")
    expect(train?.fields.find((field) => field.id === "goal")?.default).toContain("冒烟")
  })
})
