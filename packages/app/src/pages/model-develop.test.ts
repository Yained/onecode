import { describe, expect, test } from "bun:test"
import {
  datasetDownloadPrompt,
  getScientificResearchModel,
  modelDevelopDownloadStep,
  modelDevelopPrompt,
  modelDevelopPromptTemplate,
  scientificResearchPrompt,
  scientificResearchScenarioGroups,
} from "./model-develop"

describe("modelscope session prompts", () => {
  test("builds model training develop prompt", () => {
    const prompt = modelDevelopPrompt({
      modelId: "OneScience/MACE",
      developType: "training",
      title: "MACE",
      copy: "高阶等变消息传递机器学习势函数",
    })

    expect(prompt).toContain("请按照下面的内容，使用OneScience，进行后续工作。")
    expect(prompt).toContain("模型：MACE — 高阶等变消息传递机器学习势函数")
    expect(prompt).toContain("modelscope download --model OneScience/MACE --cache_dir modelscope/hub/models")
    expect(prompt).toContain("下载完成后以该 cache_dir（modelscope/hub/models）下 modelscope 实际创建的目录为准")
    expect(prompt).not.toContain("下载到 modelscope/hub/models/OneScience/MACE")
    expect(prompt).not.toContain("conda activate")
    expect(prompt).toContain("下载得到的模型目录下的 README.md 为魔搭模型仓库自带说明")
    expect(prompt).toContain("开发类型：模型训练")
    expect(prompt).toContain("优先依据 OneSkills 模型卡")
    expect(prompt).toContain("training_config")
    expect(prompt).toContain("validation_summary")
  })

  test("renders download step per runtime environment", () => {
    const local = modelDevelopDownloadStep("OneScience/MACE", { kind: "local" })
    expect(local).toContain("modelscope download --model OneScience/MACE --cache_dir modelscope/hub/models")
    expect(local).toContain("下载完成后以该 cache_dir（modelscope/hub/models）下 modelscope 实际创建的目录为准")
    expect(local).not.toContain("下载到 modelscope/hub/models/OneScience/MACE")
    expect(local).not.toContain("conda activate")

    const localConda = modelDevelopDownloadStep("OneScience/MACE", { kind: "local" }, { condaEnv: "onescience311" })
    expect(localConda).toContain("先执行 conda activate onescience311，再执行 modelscope download")
    expect(localConda).not.toContain("hub/models/OneScience/MACE")

    const ssh = modelDevelopDownloadStep(
      "OneScience/MACE",
      { kind: "ssh", targetName: "cluster-a" },
      { sshTarget: { name: "cluster-a", host: "login.example.org", remotePath: "/work/alice" } },
    )
    expect(ssh).toContain("远端 cluster-a")
    expect(ssh).not.toContain("login.example.org")
    expect(ssh).toContain("--cache_dir /work/alice/modelscope/hub/models")
    expect(ssh).toContain("下载完成后以该 cache_dir（/work/alice/modelscope/hub/models）下 modelscope 实际创建的目录为准")
    expect(ssh).not.toContain("/work/alice/modelscope/hub/models/OneScience/MACE")
    expect(ssh).not.toContain("conda activate")
    expect(ssh).toContain("不要下载到本地")

    const sshConda = modelDevelopDownloadStep(
      "OneScience/MACE",
      { kind: "ssh", targetName: "cluster-a" },
      {
        sshTarget: { name: "cluster-a", host: "login.example.org", remotePath: "/work/alice" },
        condaEnv: "onescience311",
      },
    )
    expect(sshConda).toContain("先执行 conda activate onescience311，再执行 modelscope download")
    expect(sshConda).toContain("不要下载到本地")

    const missing = modelDevelopDownloadStep("OneScience/MACE", { kind: "ssh", targetName: "gone" })
    expect(missing).toContain("配置当前不可用")

    const scnet = modelDevelopDownloadStep("OneScience/MACE", { kind: "scnet", serverName: "scnet-mcp" })
    expect(scnet).toContain("scnet-mcp MCP 工具")
    expect(scnet).toContain("把下载得到的模型目录传输到 SCNet 侧工作目录")
    expect(scnet).not.toContain("SCNet 侧：modelscope/hub/models/OneScience/MACE")
    expect(scnet).toContain("不要在 SCNet 上执行 modelscope download")
  })

  test("prompt template re-renders download step per environment", () => {
    const template = modelDevelopPromptTemplate({
      modelId: "OneScience/MACE",
      developType: "training",
      title: "MACE",
      copy: "高阶等变消息传递机器学习势函数",
    })
    const local = template({ kind: "local" })
    expect(local).toContain("--cache_dir modelscope/hub/models")
    const ssh = template(
      { kind: "ssh", targetName: "cluster-a" },
      { sshTarget: { name: "cluster-a", host: "login", remotePath: "/work" } },
    )
    expect(ssh).toContain("--cache_dir /work/modelscope/hub/models")
    expect(ssh).not.toContain("1）执行 modelscope download")
    expect(ssh).toContain("开发类型：模型训练")
    const sshConda = template(
      { kind: "ssh", targetName: "cluster-a" },
      { sshTarget: { name: "cluster-a", host: "login", remotePath: "/work" }, condaEnv: "py311" },
    )
    expect(sshConda).toContain("conda activate py311")
    const sshEmptyConda = template(
      { kind: "ssh", targetName: "cluster-a" },
      { sshTarget: { name: "cluster-a", host: "login", remotePath: "/work" }, condaEnv: "  " },
    )
    expect(sshEmptyConda).not.toContain("conda activate")
  })

  test("builds dataset download prompt without hardcoding a cache layout", () => {
    const local = datasetDownloadPrompt({ datasetId: "OneScience/ERA5", title: "ERA5" }, { kind: "local" })
    expect(local).toContain("modelscope download --dataset OneScience/ERA5 --cache_dir modelscope/hub/datasets")
    expect(local).toContain("modelscope 实际创建的目录为准")
    expect(local).not.toContain("下载到 modelscope/hub/datasets/OneScience/ERA5")
    expect(local).not.toContain("conda activate")

    const ssh = datasetDownloadPrompt(
      { datasetId: "OneScience/ERA5", title: "ERA5" },
      { kind: "ssh", targetName: "cluster-a" },
      { sshTarget: { name: "cluster-a", host: "login", remotePath: "/work" }, condaEnv: "py311" },
    )
    expect(ssh).toContain("conda activate py311")
    expect(ssh).toContain("远端 cluster-a")
    expect(ssh).not.toContain("（login）")
    expect(ssh).toContain("--cache_dir /work/modelscope/hub/datasets")
    expect(ssh).not.toContain("/work/modelscope/hub/datasets/OneScience/ERA5")
  })

  test("builds inference develop prompt", () => {
    const prompt = modelDevelopPrompt({
      modelId: "OneScience/FengWu",
      developType: "inference",
      title: "FengWu",
      copy: "OpenEarthLab 中期全球天气预报模型",
    })

    expect(prompt).toContain("开发类型：推理")
    expect(prompt).toContain("smoke inference")
    expect(prompt).toContain("inference_result")
  })

  test("builds secondary development prompt", () => {
    const prompt = modelDevelopPrompt({
      modelId: "OneScience/UMA",
      developType: "secondary-development",
      title: "UMA",
      copy: "Meta FAIR 跨化学领域通用原子势模型",
    })

    expect(prompt).toContain("开发类型：二次开发")
    expect(prompt).toContain("二次开发")
    expect(prompt).toContain("未授权前不提交远程训练")
  })

  test("builds parallel expansion prompt", () => {
    const prompt = modelDevelopPrompt({
      modelId: "OneScience/Pangu-weather",
      developType: "parallel-expansion",
      title: "Pangu-weather",
      copy: "Huawei 三维高分辨率全球天气预报模型",
    })

    expect(prompt).toContain("开发类型：并行扩展")
    expect(prompt).toContain("并行扩展")
    expect(prompt).toContain("若无先例或不适用")
  })

  test("resolves scientific research models", () => {
    expect(getScientificResearchModel("AlphaFold3")).toBe("AlphaFold3")
    expect(getScientificResearchModel("evo2")).toBe("Evo2")
    expect(getScientificResearchModel("MACE")).toBe("MACE")
    expect(getScientificResearchModel("SimpleFold")).toBeUndefined()
  })

  test("lists scientific research scenarios", () => {
    expect(scientificResearchScenarioGroups.AlphaFold3[0].scenarios).toHaveLength(5)
    expect(scientificResearchScenarioGroups.Evo2[0].scenarios).toHaveLength(4)
    expect(scientificResearchScenarioGroups.Evo2[1].scenarios).toHaveLength(3)
    expect(scientificResearchScenarioGroups.MACE[0].scenarios).toHaveLength(5)
  })

  test("builds AlphaFold3 scientific research prompt", () => {
    const prompt = scientificResearchPrompt("AlphaFold3", "af3-paper-7pzb")
    expect(prompt).toContain("AlphaFold 3 论文 Figure 1a")
    expect(prompt).toContain("7PZB")
    expect(prompt).toContain("bioscience")
  })

  test("builds Evo2 scientific research prompt", () => {
    const prompt = scientificResearchPrompt("Evo2", "evo2-github-dna-generation")
    expect(prompt).toContain("DNA autocompletion")
    expect(prompt).toContain("bioscience-evo2")
    expect(prompt).toContain("4096 bp")
  })

  test("builds MACE scientific research prompt", () => {
    const prompt = scientificResearchPrompt("MACE", "mace-vasp-trajectory-training")
    expect(prompt).toContain("Cu(111)-40H2O-K")
    expect(prompt).toContain("VASP AIMD")
    expect(prompt).toContain("H/C/O/K/Cu")
  })
})
