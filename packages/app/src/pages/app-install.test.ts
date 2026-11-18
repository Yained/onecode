import { describe, expect, test } from "bun:test"
import { appInstallPrompt } from "./app-install"

const adaptiveCpp = {
  title: "AdaptiveCpp",
  copy: "面向 CPU/GPU 的 SYCL 与 C++ 异构并行编译器和运行时",
  format: "CPU/GPU",
  href: "https://dos.sourcefind.cn:50275/portal/#/installation?id=38bbdeb3-f965-11ef-be71-0242ac170002&type=frame",
}

describe("app install prompts", () => {
  test("builds app install prompt with official doc href", () => {
    expect(appInstallPrompt(adaptiveCpp)).toBe(
      "请按照下面的内容，使用OneScience，进行后续工作。\n————————\n请帮我在当前本地环境安装 OneHub 应用「AdaptiveCpp」。\n\n安装说明请从官方文档获取并严格遵循：https://dos.sourcefind.cn:50275/portal/#/installation?id=38bbdeb3-f965-11ef-be71-0242ac170002&type=frame\n应用简介：面向 CPU/GPU 的 SYCL 与 C++ 异构并行编译器和运行时；目标平台：CPU/GPU。\n\n请先检查本地环境是否满足要求，再按文档完成安装与验证；文档中的占位路径或缺失信息先向我确认。成功则汇报安装位置与验证结果，失败则列出阻塞项和最小修复方案。",
    )
  })

  test("rewrites install location for ssh and scnet environments", () => {
    const ssh = appInstallPrompt(
      adaptiveCpp,
      { kind: "ssh", targetName: "cluster-a" },
      { sshTarget: { name: "cluster-a", host: "login.example.org", remotePath: "/work/alice" } },
    )
    expect(ssh).toContain("在远端 cluster-a 上通过 ssh 安装")
    expect(ssh).toContain("不要安装到本地")
    expect(ssh).not.toContain("当前本地环境")
    expect(ssh).not.toContain("login.example.org")

    const sshConda = appInstallPrompt(
      adaptiveCpp,
      { kind: "ssh", targetName: "cluster-a" },
      {
        sshTarget: { name: "cluster-a", host: "login.example.org", remotePath: "/work/alice" },
        condaEnv: "onescience311",
      },
    )
    expect(sshConda).toContain("先执行 conda activate onescience311")
    expect(sshConda).not.toContain("当前本地环境")

    const missing = appInstallPrompt(adaptiveCpp, { kind: "ssh", targetName: "gone" })
    expect(missing).toContain("配置当前不可用")

    const scnet = appInstallPrompt(adaptiveCpp, { kind: "scnet", serverName: "scnet-mcp" })
    expect(scnet).toContain("在 SCNet 环境安装")
    expect(scnet).toContain("scnet-mcp MCP")
    expect(scnet).not.toContain("当前本地环境")
  })
})
