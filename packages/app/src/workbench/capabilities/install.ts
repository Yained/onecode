import { base64Encode } from "@opencode-ai/core/util/encode"
import { showToast } from "@opencode-ai/ui/toast"
import {
  codeEntryWorkspaceDirectory,
  configuredCodeDefaultDirectory,
} from "@/app-routes"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { pushSessionHandoffDraft } from "@/pages/session/handoff"
import { defaultPlatformProjectDirectory, storedPlatformAuthSession } from "@/utils/platform-auth"
import { requirePersonalSpace } from "@/workbench/require-auth"
import { workspaceSessionHref } from "@/workbench/routes"
import { getCapabilityResource } from "./catalog"
import { isCapabilityResourceInstallable, modelScopeIdForCapability } from "./model-resources"
import { modelDevelopDownloadStep } from "@/pages/model-develop"

function withModelScopeDownload(prompt: string, modelId: string) {
  if (prompt.includes("modelscope download --model ")) return prompt
  return `${prompt}\n\n【从魔搭下载模型】\n${modelDevelopDownloadStep(modelId, { kind: "local" })}`
}

export function buildInstallHandoff(resourceId: string) {
  const resource = getCapabilityResource(resourceId)
  if (!resource) throw new Error(`Unknown capability resource: ${resourceId}`)
  if (!isCapabilityResourceInstallable(resource)) {
    throw new Error(`Capability resource is not installable: ${resourceId}`)
  }
  const modelId = modelScopeIdForCapability(resource)
  return {
    banner: resource.install.banner,
    prompt: modelId ? withModelScopeDownload(resource.install.prompt, modelId) : resource.install.prompt,
  }
}

export type StartCapabilityInstallInput = {
  resourceId: string
  navigate: (href: string) => void
  isLoggedIn: boolean
  path: Parameters<typeof codeEntryWorkspaceDirectory>[0]["path"]
  recent: Parameters<typeof codeEntryWorkspaceDirectory>[0]["recent"]
  lastCodeWorkspace?: string
  openProject?: (directory: string) => void
  touchCode?: (directory: string) => void
}

export function startCapabilityInstall(input: StartCapabilityInstallInput) {
  if (
    !requirePersonalSpace({
      navigate: input.navigate,
      action: { type: "install", resourceId: input.resourceId },
      isLoggedIn: input.isLoggedIn,
    })
  ) {
    return false
  }

  const resource = getCapabilityResource(input.resourceId)
  if (!resource || !isCapabilityResourceInstallable(resource)) return false

  const { banner, prompt } = buildInstallHandoff(input.resourceId)
  const directory =
    codeEntryWorkspaceDirectory({
      path: input.path,
      recent: input.recent,
      lastCodeWorkspace: input.lastCodeWorkspace,
    }) ||
    defaultPlatformProjectDirectory(storedPlatformAuthSession()) ||
    configuredCodeDefaultDirectory(document, input.path)

  if (!directory) return false

  const slug = base64Encode(directory)
  pushSessionHandoffDraft(slug, prompt)
  markCodeNewSessionIntent(slug)
  input.openProject?.(directory)
  input.touchCode?.(directory)
  showToast({ variant: "success", title: banner })
  input.navigate(workspaceSessionHref(directory))
  return true
}
