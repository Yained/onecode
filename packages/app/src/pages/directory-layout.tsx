import { DataProvider } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { useRouteParams } from "@/hooks/use-route-params"
import { useProviders } from "@/hooks/use-providers"
import { createEffect, createMemo, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { decode64 } from "@/utils/base64"
import { resolveArtifactImageUrl } from "@/utils/artifact-image-url"
import { isRemoteWorkspaceConnected, remoteWorkspaceFor } from "@/components/onescience/remote-workspace"

function DirectoryDataProvider(props: ParentProps<{ prefix?: string }>) {
  const navigate = useNavigate()
  const params = useRouteParams()
  const sync = useSync()
  const sdk = useSDK()
  const providers = useProviders()
  const slug = createMemo(() => base64Encode(sdk.directory))
  const prefix = () => props.prefix ?? ""
  const sessionHref = (sessionID?: string) => `${prefix()}/${slug()}/session${sessionID ? `/${sessionID}` : ""}`

  // Do not createResource(session.sync) here — Session page owns open/sync. A second
  // sync on the same id doubled message reconcile and timeline projection on the
  // main thread (Chrome「页面无响应」after transcript painted on remote cold open).

  // Message chrome (Build · model · time) reads provider names from DataProvider.
  // Prefer the same merged catalog as the model picker — instance sync alone often
  // lacks global presets (e.g. onescience/glm-5.2 → "OneScience GLM").
  const data = new Proxy(sync.data, {
    get(target, prop, receiver) {
      if (prop === "provider") {
        return {
          all: providers.all(),
          connected: providers.connected().map((item) => item.id),
          default: providers.default(),
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

  const loadArtifactImage = async (filePath: string) => {
    const sessionID = params.id
    const messages = sessionID ? (sync.data.message[sessionID] ?? []) : []
    return resolveArtifactImageUrl({
      sdk: sdk.client,
      directory: sdk.directory,
      filePath,
      messages,
      parts: sync.data.part,
    })
  }

  return (
    <DataProvider
      data={data}
      directory={sdk.directory}
      loadArtifactImage={loadArtifactImage}
      onNavigateToSession={(sessionID: string) => navigate(sessionHref(sessionID))}
      onSessionHref={(sessionID: string) => sessionHref(sessionID)}
      onAbortSession={(sessionID) => {
        sdk.client.session.abort({ sessionID }).catch(() => {})
      }}
      onHydrateMessageParts={(sessionID, messageID) => sync.session.history.hydrateMessage(sessionID, messageID)}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

function DirectorySwitchFallback() {
  return (
    <div class="os-route-fallback os-directory-switching" aria-busy="true">
      <div class="os-directory-switching-pulse" />
      <div class="os-directory-switching-pulse is-short" />
      <div class="os-directory-switching-pulse is-mid" />
    </div>
  )
}

export default function Layout(props: ParentProps<{ prefix?: string }>) {
  const params = useRouteParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  createEffect((previous: string | undefined) => {
    const current = resolved()
    if (previous && previous !== current && isRemoteWorkspaceConnected(remoteWorkspaceFor(previous))) {
      const parts = previous.replaceAll("\\", "/").split("/").filter(Boolean)
      const name = parts[parts.length - 1] ?? previous
      showToast({
        title: "远端连接仍保持",
        description: `已切离项目「${name}」，SSH 未断开。切回后可继续使用，或在该项目中点断开。`,
      })
    }
    return current
  })

  // Keep SDK/Sync mounted across project switches (directory is reactive).
  // Remount only LocalProvider + session (workspace persist is per-directory).
  // A persistent underlay removes the blank white flash during that remount.
  return (
    <Show when={resolved()} fallback={<DirectorySwitchFallback />}>
      {(dir) => (
        <SDKProvider directory={() => dir()}>
          <SyncProvider>
            <div class="os-directory-shell">
              <div class="os-directory-shell-underlay" aria-hidden="true">
                <DirectorySwitchFallback />
              </div>
              <div class="os-directory-shell-content">
                <Show when={dir()} keyed>
                  <DirectoryDataProvider prefix={props.prefix}>{props.children}</DirectoryDataProvider>
                </Show>
              </div>
            </div>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
