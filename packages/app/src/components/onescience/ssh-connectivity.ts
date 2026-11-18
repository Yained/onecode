import {
  listRegisteredSshTargets,
  sshTestPayload,
  type RegisteredSshTarget,
  type SshConnectivityState,
  type SshTargetOption,
} from "@/components/onescience/execution-location"
import { authTokenFromCredentials } from "@/utils/server"

type SshTestResult = {
  success: boolean
  message: string
}

export type SshProbeProgress = {
  current: number
  total: number
  name: string
}

const SSH_TEST_TIMEOUT_MS = 20_000

export function localizeSshConnectivityMessage(message: string) {
  if (
    /Executable not found in \$PATH:\s*["']?ssh["']?/i.test(message) ||
    /spawn ssh ENOENT/i.test(message) ||
    /cannot find ssh on this process PATH/i.test(message) ||
    /cannot find the ssh executable/i.test(message)
  ) {
    const pathMatch = message.match(/Process PATH=(.*)$/s)
    const pathHint = pathMatch?.[1]?.trim()
    const suffix = pathHint ? ` 当前服务进程 PATH=${pathHint}` : ""
    return `OneCode 后端进程的 PATH 里找不到 ssh（登录 shell 里 which ssh 能找到也不算）。连通性检测由 onecode serve 进程执行，请给该服务补上 PATH=/usr/local/bin:/usr/bin:/bin 后重启，或升级后由服务用 /usr/bin/ssh 绝对路径调用。${suffix}`
  }
  return message
}

export async function testRegisteredSshTarget(
  globalUrl: string,
  target: SshTargetOption,
  auth?: { username?: string; password?: string },
  signal?: AbortSignal,
  platformToken?: string,
): Promise<{ state: Exclude<SshConnectivityState, "idle" | "testing">; message: string }> {
  if (target.enabled === false) {
    return { state: "skipped", message: "配置已禁用，未执行连通性检测" }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (auth?.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: auth.username,
      password: auth.password,
    })}`
  }
  if (platformToken) headers["x-platform-auth-token"] = platformToken
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SSH_TEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort)
  try {
    const response = await fetch(`${globalUrl.replace(/\/$/, "")}/global/ssh/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({ config: sshTestPayload(target) }),
      signal: controller.signal,
    })
    const text = await response.text()
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("text/html") || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
      return { state: "failed", message: "当前 server 未加载 SSH 测试接口" }
    }
    const data = contentType.includes("application/json") && text ? JSON.parse(text) as SshTestResult : undefined
    if (response.ok && data?.success) {
      return { state: "connected", message: data.message || "连接成功，远程目录可访问" }
    }
    return { state: "failed", message: localizeSshConnectivityMessage(data?.message || text.trim() || response.statusText || "连接失败") }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { state: "failed", message: "连通性检测超时" }
    }
    return { state: "failed", message: localizeSshConnectivityMessage(error instanceof Error ? error.message : String(error)) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

export async function probeRegisteredSshTargets(
  globalUrl: string,
  ssh: Parameters<typeof listRegisteredSshTargets>[0],
  auth?: { username?: string; password?: string },
  options?: {
    signal?: AbortSignal
    platformToken?: string
    onProgress?: (progress: SshProbeProgress) => void
  },
): Promise<RegisteredSshTarget[]> {
  const targets = listRegisteredSshTargets(ssh)
  const results: RegisteredSshTarget[] = []
  for (let index = 0; index < targets.length; index++) {
    if (options?.signal?.aborted) break
    const target = targets[index]
    options?.onProgress?.({
      current: index + 1,
      total: targets.length,
      name: target.name,
    })
    if (target.enabled === false) {
      results.push({
        ...target,
        connectivity: "skipped",
        connectivityMessage: "已禁用",
      })
      continue
    }
    const result = await testRegisteredSshTarget(
      globalUrl,
      target,
      auth,
      options?.signal,
      options?.platformToken,
    )
    results.push({
      ...target,
      connectivity: result.state,
      connectivityMessage: result.message,
    })
  }
  return results
}

export function formatSshProbeProgress(progress: SshProbeProgress | undefined, fallback = "检测中...") {
  if (!progress || progress.total <= 0) return fallback
  return `${fallback}（${progress.current}/${progress.total}）· ${progress.name}`
}
