export const CONNECT_STEPS = [
  { id: "preflight", message: "检测执行条件" },
  { id: "prepare", message: "准备远端目录" },
  { id: "serve", message: "启动 onecode serve" },
  { id: "health", message: "确认服务已启动" },
  { id: "tunnel", message: "建立本机隧道" },
  { id: "init", message: "初始化远端环境" },
] as const

export const PREFLIGHT_STEPS = [
  { id: "ssh", message: "检测 SSH 连通" },
  { id: "remotePath", message: "检查远端目录" },
  { id: "marker", message: "检查目录占用" },
  { id: "onecode", message: "检测 onecode" },
] as const

export type ConnectStepId = (typeof CONNECT_STEPS)[number]["id"]
export type PreflightStepId = (typeof PREFLIGHT_STEPS)[number]["id"]
export type ConnectStepStatus = "pending" | "current" | "ok" | "fail"

export type ConnectStep = {
  id: string
  message: string
  status: ConnectStepStatus
  detail?: string
}

type NamedStep = { id: string; message: string }

type State = { steps: ConnectStep[] }

const store = new Map<string, State>()

export function connectProgressKey(sshTarget: string, directory: string) {
  return `${sshTarget.trim()}::${directory.replaceAll("\\", "/")}`
}

export function preflightProgressKey(sshTarget: string, directory: string) {
  return `preflight::${connectProgressKey(sshTarget, directory)}`
}

function cloneNamed(definitions: readonly NamedStep[], statusFor: (index: number) => ConnectStepStatus): ConnectStep[] {
  return definitions.map((item, index) => ({
    id: item.id,
    message: item.message,
    status: statusFor(index),
  }))
}

function cloneSteps(statusFor: (index: number) => ConnectStepStatus): ConnectStep[] {
  return cloneNamed(CONNECT_STEPS, statusFor)
}

function beginNamedProgress(key: string, definitions: readonly NamedStep[]) {
  if (!key.trim()) return
  store.set(key, { steps: cloneNamed(definitions, (index) => (index === 0 ? "current" : "pending")) })
}

function markNamedStep(key: string, definitions: readonly NamedStep[], id: string) {
  if (!key.trim()) return
  const idx = definitions.findIndex((item) => item.id === id)
  if (idx < 0) return
  const details = new Map(
    (store.get(key)?.steps ?? []).flatMap((step) => (step.detail ? [[step.id, step.detail] as const] : [])),
  )
  store.set(key, {
    steps: cloneNamed(definitions, (index) => (index < idx ? "ok" : index === idx ? "current" : "pending")).map(
      (step) =>
        step.status === "current" && details.has(step.id) ? { ...step, detail: details.get(step.id) } : step,
    ),
  })
}

export function setConnectStepDetail(key: string, id: string, detail: string) {
  if (!key.trim() || !detail.trim()) return
  const current = store.get(key)
  if (!current) return
  store.set(key, {
    steps: current.steps.map((step) => (step.id === id ? { ...step, detail } : step)),
  })
}

export function beginConnectProgress(key: string) {
  beginNamedProgress(key, CONNECT_STEPS)
}

export function markConnectStep(key: string, id: ConnectStepId) {
  if (isConnectProgressComplete(key)) return
  markNamedStep(key, CONNECT_STEPS, id)
}

export function beginPreflightProgress(key: string) {
  beginNamedProgress(key, PREFLIGHT_STEPS)
}

export function markPreflightStep(key: string, id: PreflightStepId) {
  markNamedStep(key, PREFLIGHT_STEPS, id)
}

export function finishConnectProgress(key: string, ok: boolean) {
  if (!key.trim()) return
  const current = store.get(key)
  if (!current) {
    store.set(key, { steps: cloneSteps(() => (ok ? "ok" : "pending")) })
    return
  }
  store.set(key, {
    steps: current.steps.map((step) => ({
      ...step,
      status: ok ? "ok" : step.status === "current" ? "fail" : step.status,
    })),
  })
}

export function getConnectProgress(key: string): ConnectStep[] {
  return store.get(key)?.steps ?? []
}

/** True after a successful create. Retunnel must not rewind the UI to 健康检查. */
export function isConnectProgressComplete(key: string) {
  if (!key.trim()) return false
  const steps = store.get(key)?.steps
  return Boolean(steps?.length && steps.every((step) => step.status === "ok"))
}
