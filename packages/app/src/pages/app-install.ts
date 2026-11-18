import type { RuntimeEnvironment } from "@/components/onescience/runtime-environment"
import type { HandoffPromptContext, HandoffPromptTemplate } from "@/pages/session/handoff"
import { modelScopeTaskPromptHeader } from "./model-develop"

export type AppInstallPromptInput = {
  title: string
  copy: string
  format: string
  href: string
}

function condaPrefix(condaEnv: string | undefined) {
  const name = condaEnv?.trim()
  return name ? `先执行 conda activate ${name}，再` : "先"
}

export function appInstallPrompt(
  item: AppInstallPromptInput,
  env?: RuntimeEnvironment,
  ctx?: HandoffPromptContext,
) {
  const intro = `安装说明请从官方文档获取并严格遵循：${item.href}
应用简介：${item.copy}；目标平台：${item.format}。`
  const confirm =
    "文档中的占位路径或缺失信息先向我确认。成功则汇报安装位置与验证结果，失败则列出阻塞项和最小修复方案。"
  const conda = condaPrefix(ctx?.condaEnv)

  if (env?.kind === "ssh") {
    const target = ctx?.sshTarget
    if (!target) {
      return `${modelScopeTaskPromptHeader}请帮我在 SSH 远程（${env.targetName}）安装 OneHub 应用「${item.title}」。

运行环境为 SSH 远程（${env.targetName}），但该配置当前不可用；请先在运行环境选择框中重新选择环境，再安装应用。`
    }
    return `${modelScopeTaskPromptHeader}请帮我在远端 ${target.name} 上通过 ssh 安装 OneHub 应用「${item.title}」。

${intro}

请${conda}检查该远端环境是否满足要求，并按文档完成安装与验证；后续安装与验证均在该远端环境执行，不要安装到本地。
${confirm}`
  }

  if (env?.kind === "scnet") {
    const server = env.serverName ?? "scnet"
    return `${modelScopeTaskPromptHeader}请帮我在 SCNet 环境安装 OneHub 应用「${item.title}」。

${intro}

请通过 ${server} MCP 工具在 SCNet 侧检查环境并按文档完成安装与验证，不要安装到本地。
${confirm}`
  }

  const localLead = conda === "先" ? "请先检查本地环境是否满足要求，再" : `请${conda}检查本地环境是否满足要求，并`
  return `${modelScopeTaskPromptHeader}请帮我在当前本地环境安装 OneHub 应用「${item.title}」。

${intro}

${localLead}按文档完成安装与验证；${confirm}`
}

export function appInstallPromptTemplate(item: AppInstallPromptInput): HandoffPromptTemplate {
  return (env, ctx) => appInstallPrompt(item, env, ctx)
}
