import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import type { Config } from "@opencode-ai/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { fetchManagedOpenSshDisk, hydrateSshFromOpenSshTargets } from "@/context/global-sync/bootstrap"
import { useServer } from "@/context/server"
import {
  listRegisteredSshTargets,
  type RegisteredSshTarget,
  type SshTargetOption,
} from "@/components/onescience/execution-location"
import {
  formatSshProbeProgress,
  probeRegisteredSshTargets,
  testRegisteredSshTarget,
  type SshProbeProgress,
} from "@/components/onescience/ssh-connectivity"
import { storedPlatformAuthToken } from "@/utils/platform-auth"

type SshConfigMap = Parameters<typeof listRegisteredSshTargets>[0]

const [sharedTargets, setSharedTargets] = createSignal<RegisteredSshTarget[]>([])
const [sharedLoading, setSharedLoading] = createSignal(false)
const [sharedProgress, setSharedProgress] = createSignal<SshProbeProgress | undefined>()
const [sharedDiskSsh, setSharedDiskSsh] = createSignal<Config["ssh"] | undefined>()
let sharedDiskGeneration = 0
let sharedDiskHydrate: Promise<void> | undefined

/** Keep the runtime-environment selector in sync with SSH config save/delete (disk list). */
export function rememberManagedSshMap(ssh: Config["ssh"] | undefined) {
  sharedDiskGeneration += 1
  setSharedDiskSsh(ssh)
}

export function managedSshMapGeneration() {
  return sharedDiskGeneration
}

function hydrateSharedOpenSshDisk(serverUrl: string, queryClient: ReturnType<typeof useQueryClient>) {
  if (sharedDiskHydrate) return sharedDiskHydrate
  const generation = sharedDiskGeneration
  sharedDiskHydrate = (async () => {
    const disk = await fetchManagedOpenSshDisk(serverUrl)
    if (generation !== sharedDiskGeneration) return
    if (disk !== undefined) setSharedDiskSsh(disk)
    // Reuse the same disk payload — a second /targets fetch often stays Pending on HTTP/1.1
    // and freezes clicks on cache-clear /workspace.
    await hydrateSshFromOpenSshTargets({
      serverUrl,
      queryClient,
      disk,
    }).catch(() => undefined)
  })().finally(() => {
    sharedDiskHydrate = undefined
  })
  return sharedDiskHydrate
}

/** OpenSSH disk map when the product config.ssh pin is incomplete. */
export function currentOpenSshTargetMap(fallback?: Config["ssh"]) {
  return sharedDiskSsh() ?? fallback
}

/** Call before 检测/连接/env picker — never auto-fetch /targets on session cold start. */
export function ensureOpenSshDiskHydrated(
  serverUrl: string,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return hydrateSharedOpenSshDisk(serverUrl, queryClient)
}

export function useOpenSshTargetMap() {
  const globalSync = useGlobalSync()
  // Session + welcome cold start must not open /global/ssh/targets (screenshot: 14s
  // waterfall freezes clicks). Bootstrap defers hydrate; 检测/连接 call ensure*.
  return createMemo(() => currentOpenSshTargetMap(globalSync.data.config.ssh))
}

let probeGeneration = 0
let activeAbort: AbortController | undefined
const probeOneAborts = new Map<string, AbortController>()
const [sharedProbingNames, setSharedProbingNames] = createSignal<ReadonlySet<string>>(new Set<string>())

function asSshConfigMap(ssh: Config["ssh"] | undefined): SshConfigMap {
  // Config.ssh may include enabled-only stubs; listRegisteredSshTargets filters those out.
  return ssh as SshConfigMap
}

function setNameProbing(name: string, probing: boolean) {
  setSharedProbingNames((prev) => {
    const next = new Set(prev)
    if (probing) next.add(name)
    else next.delete(name)
    return next
  })
}

function abortProbeOne(name?: string) {
  if (name) {
    probeOneAborts.get(name)?.abort()
    probeOneAborts.delete(name)
    setNameProbing(name, false)
    return
  }
  for (const controller of probeOneAborts.values()) controller.abort()
  probeOneAborts.clear()
  setSharedProbingNames(new Set<string>())
}

function upsertSharedTarget(target: RegisteredSshTarget) {
  setSharedTargets((prev) => {
    const index = prev.findIndex((item) => item.name === target.name)
    if (index === -1) return [...prev, target]
    const next = prev.slice()
    next[index] = target
    return next
  })
}

function mergeConnectivity(
  listed: SshTargetOption[],
  probed: RegisteredSshTarget[],
): RegisteredSshTarget[] {
  const byName = Object.fromEntries(probed.map((item) => [item.name, item]))
  return listed.map((item) => {
    const prev = byName[item.name]
    if (prev && prev.host === item.host && prev.remotePath === item.remotePath) {
      return {
        ...item,
        connectivity: prev.connectivity,
        connectivityMessage: prev.connectivityMessage,
      }
    }
    return { ...item, connectivity: "idle" as const }
  })
}

async function runProbe(input: {
  globalUrl: string
  ssh: SshConfigMap
  auth?: { username?: string; password?: string }
  platformToken?: string
}) {
  abortProbeOne()
  activeAbort?.abort()
  const controller = new AbortController()
  activeAbort = controller
  const generation = ++probeGeneration
  setSharedLoading(true)
  setSharedProgress(undefined)
  try {
    const result = await probeRegisteredSshTargets(input.globalUrl, input.ssh, input.auth, {
      signal: controller.signal,
      platformToken: input.platformToken,
      onProgress: (progress) => {
        if (generation !== probeGeneration) return
        setSharedProgress(progress)
      },
    })
    if (generation !== probeGeneration || controller.signal.aborted) return
    setSharedTargets(result)
  } finally {
    if (generation === probeGeneration) {
      setSharedLoading(false)
      setSharedProgress(undefined)
      if (activeAbort === controller) activeAbort = undefined
    }
  }
}

async function runProbeOne(input: {
  globalUrl: string
  target: SshTargetOption
  auth?: { username?: string; password?: string }
  platformToken?: string
}) {
  abortProbeOne(input.target.name)
  const controller = new AbortController()
  probeOneAborts.set(input.target.name, controller)
  setNameProbing(input.target.name, true)
  upsertSharedTarget({
    ...input.target,
    connectivity: "testing",
    connectivityMessage: undefined,
  })
  try {
    const result = await testRegisteredSshTarget(
      input.globalUrl,
      input.target,
      input.auth,
      controller.signal,
      input.platformToken,
    )
    if (controller.signal.aborted) return
    upsertSharedTarget({
      ...input.target,
      connectivity: result.state,
      connectivityMessage: result.message,
    })
  } finally {
    if (probeOneAborts.get(input.target.name) === controller) {
      probeOneAborts.delete(input.target.name)
      setNameProbing(input.target.name, false)
    }
  }
}

export function useRegisteredSshConnectivity(options?: {
  auto?: Accessor<boolean>
  /** Prefer the same map the UI lists (e.g. OpenSSH disk), not a stale config.ssh pin. */
  ssh?: Accessor<Config["ssh"] | undefined>
}) {
  const globalSDK = useGlobalSDK()
  const server = useServer()

  const openSshMap = useOpenSshTargetMap()
  const sshSource = createMemo(() => asSshConfigMap(options?.ssh?.() ?? openSshMap()))

  const listed = createMemo(() => listRegisteredSshTargets(sshSource()))

  const targets = createMemo(() => mergeConnectivity(listed(), sharedTargets()))

  const probeAuth = () =>
    server.current?.http.password
      ? { username: server.current.http.username, password: server.current.http.password }
      : undefined

  const probe = () => {
    return runProbe({
      globalUrl: globalSDK.url,
      ssh: sshSource(),
      auth: probeAuth(),
      platformToken: storedPlatformAuthToken() || undefined,
    })
  }

  const probeOne = (name: string) => {
    const target = listed().find((item) => item.name === name)
    if (!target) return Promise.resolve()
    return runProbeOne({
      globalUrl: globalSDK.url,
      target,
      auth: probeAuth(),
      platformToken: storedPlatformAuthToken() || undefined,
    })
  }

  createEffect(() => {
    const shouldAuto = options?.auto?.() === true
    if (!shouldAuto) return
    // Track sshSource so auto-probe re-runs after disk hydrate fills the list.
    void sshSource()
    // untrack: probe() must not subscribe this effect to sharedLoading, or it loops forever.
    void untrack(() => probe())
    onCleanup(() => {
      activeAbort?.abort()
    })
  })

  const byName = createMemo(() => Object.fromEntries(targets().map((item) => [item.name, item])))
  const connectable = createMemo(() =>
    targets().filter((item) => item.enabled !== false && item.connectivity === "connected"),
  )
  const progressLabel = createMemo(() =>
    formatSshProbeProgress(sharedProgress(), "检测中..."),
  )
  const probing = (name: string) => sharedProbingNames().has(name)

  return {
    targets,
    loading: sharedLoading,
    progress: sharedProgress,
    progressLabel,
    byName,
    connectable,
    probe,
    probeOne,
    probing,
  }
}
