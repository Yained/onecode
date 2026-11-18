import type { Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { pathKey } from "@/utils/path-key"
import { platformWorkspacePathAliases, storedPlatformAuthSession } from "@/utils/platform-auth"
import { boundWorkspaceID, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import { runtimeEnvironmentRevision } from "@/components/onescience/runtime-environment"
import { useGlobalSDK } from "./global-sdk"
import { showToast } from "@opencode-ai/ui/toast"

type SDKEventMap = {
  [key in Event["type"]]: Extract<Event, { type: key }>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: Accessor<string> }) => {
    const globalSDK = useGlobalSDK()

    const directory = createMemo(props.directory)
    // Recreate the HTTP client only when the bind actually changes. Bumping
    // remoteWorkspaceRevision on every status poll remounted the workbench
    // (file tree + timeline) while the model was still streaming.
    const clientKey = createMemo(() => {
      remoteWorkspaceRevision()
      runtimeEnvironmentRevision()
      const current = directory()
      return `${pathKey(current)}\0${boundWorkspaceID(current) ?? ""}`
    })
    const client = createMemo(() => {
      clientKey()
      return globalSDK.createClient({
        directory: directory(),
        throwOnError: true,
        experimental_workspaceID: boundWorkspaceID(directory()),
      })
    })

    const emitter = createGlobalEmitter<SDKEventMap>()

    createEffect(() => {
      const current = directory()
      const sdk = client()
      const workspaceID = boundWorkspaceID(current)
      if (!current || !workspaceID) return
      void sdk.sync.start({ directory: current }).catch((error) => {
        if (boundWorkspaceID(current) !== workspaceID) return
        // Keep the live ssh-node binding. Dropping it here made /file and /pty
        // fall back to A's identity directory while the env bar still said 已连接.
        const message = error instanceof Error ? error.message.trim() : ""
        showToast({
          title: "远端同步失败",
          description: message || "文件树与终端仍走已连接的远端；若异常请重新连接",
        })
      })
    })

    createEffect(() => {
      const current = directory()
      const currentKey = pathKey(current)
      const unsub = globalSDK.event.listen((event) => {
        if (
          pathKey(event.name) !== currentKey &&
          !platformWorkspacePathAliases(storedPlatformAuthSession(), event.name).some((alias) => pathKey(alias) === currentKey)
        ) {
          return
        }
        emitter.emit(event.details.type, event.details)
      })
      onCleanup(unsub)
    })

    return {
      get directory() {
        return directory()
      },
      get client() {
        return client()
      },
      event: emitter,
      get url() {
        return globalSDK.url
      },
      createClient(opts: Parameters<typeof globalSDK.createClient>[0]) {
        remoteWorkspaceRevision()
        runtimeEnvironmentRevision()
        const workspaceID = opts.experimental_workspaceID ?? boundWorkspaceID(opts.directory ?? directory())
        return globalSDK.createClient({
          ...opts,
          experimental_workspaceID: workspaceID || undefined,
        })
      },
    }
  },
})
