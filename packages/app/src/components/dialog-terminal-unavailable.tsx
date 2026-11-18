import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Show, createMemo } from "solid-js"
import { boundWorkspaceID, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import { useRouteParams } from "@/hooks/use-route-params"
import { decode64 } from "@/utils/base64"
import {
  platformTerminalInstallCommands,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"

type Props = {
  /** Server / client error from the failed POST /pty create call. */
  failure?: string
}

export function DialogTerminalUnavailable(props: Props = {}) {
  const dialog = useDialog()
  const params = useRouteParams()
  const session = createMemo(() => storedPlatformAuthSession())
  const reason = createMemo(() => session()?.capabilities.terminalUnavailableReason ?? "")
  const detail = createMemo(() => session()?.capabilities.terminalUnavailableDetail ?? "")
  const isolation = createMemo(() => session()?.capabilities.terminalIsolation ?? "")
  const failure = createMemo(() => (props.failure ?? "").trim())
  /** Backend already allows terminals — failure is create/connect, not missing deps. */
  const allowedButFailed = createMemo(
    () => Boolean(session()) && session()?.capabilities.terminal === true && !reason(),
  )
  const runtimeFailure = createMemo(
    () => !reason() && !allowedButFailed() && isolation() === "bubblewrap",
  )
  const sshRemote = createMemo(() => {
    remoteWorkspaceRevision()
    return Boolean(boundWorkspaceID(decode64(params.dir) ?? ""))
  })

  const commands = createMemo((): string[] => {
    if (sshRemote()) return []
    if (allowedButFailed() && failure()) return []
    if (allowedButFailed()) {
      if (isolation() === "docker") {
        return [
          "# 1) 无 GPU：改用 bubblewrap 后重启 OneCode，并重新登录",
          "export ONECODE_TERMINAL_ISOLATION=bubblewrap",
          "# 2) 有 GPU 且必须用 docker：给运行账号加组后重新登录系统再启 OneCode",
          "sudo usermod -aG docker \"$USER\"",
          "docker info",
        ]
      }
      if (isolation() === "bubblewrap") {
        return [
          "# A. 临时绕过隔离（先验证终端能否打开）",
          "export ONECODE_TERMINAL_ISOLATION=native",
          "# 然后重启 onecode，浏览器重新登录后再开终端",
          "",
          "# B. 继续用 bubblewrap 时，在运行 OneCode 的机器上检查：",
          "which bwrap; bwrap --version",
          "bwrap --unshare-all --share-net --die-with-parent --new-session --proc /proc --dev /dev --ro-bind-try /usr /usr --ro-bind-try /bin /bin --tmpfs /tmp -- /usr/bin/true; echo exit:$?",
          "cat /proc/sys/kernel/unprivileged_userns_clone",
          "cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true",
          "",
          "# C. 若 exit 非 0，可临时放开（需管理员；重启后可能失效）",
          "sudo sysctl -w kernel.unprivileged_userns_clone=1",
          "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
          "",
          "# D. 服务端日志（搜 creating session / exited）",
          "ls ~/.local/share/opencode/log/ 2>/dev/null || ls \"$HOME\"/.local/share/opencode/log/",
        ]
      }
      return [
        "# 查看服务端日志（搜 creating session / exited）",
        "ls ~/.local/share/opencode/log/ 2>/dev/null || ls \"$HOME\"/.local/share/opencode/log/",
        "# 临时可改：export ONECODE_TERMINAL_ISOLATION=native 后重启并重新登录",
      ]
    }
    const listed = platformTerminalInstallCommands(session())
    if (Array.isArray(listed) && listed.length > 0) return listed
    if (!runtimeFailure()) return []
    return [
      "export ONECODE_TERMINAL_ISOLATION=native",
      "cat /proc/sys/kernel/unprivileged_userns_clone",
    ]
  })
  const hasCommands = createMemo(() => commands().length > 0)

  const title = createMemo(() => {
    if (sshRemote()) return "无法打开终端"
    if (allowedButFailed()) return "无法打开终端"
    if (reason() === "docker-missing") return "无法打开终端：Docker 不可用"
    if (reason() === "disabled") return "无法打开终端：服务未启用"
    if (reason() === "bubblewrap-unusable") return "无法打开终端：bubblewrap 异常"
    if (runtimeFailure()) return "无法打开终端：隔离环境异常"
    return "无法打开终端：需要 bubblewrap"
  })

  const description = createMemo(() => {
    if (sshRemote() && failure()) {
      return "在远端创建或连接普通 shell 失败。下方是服务端返回；远端终端不使用本机 bubblewrap。"
    }
    if (sshRemote()) {
      return "SSH 已连接时，终端应在远端以普通 shell 打开，不使用本机 bubblewrap。请关闭失效标签后新建，或断开后重新连接远端再打开终端。"
    }
    if (allowedButFailed() && failure()) {
      return "创建终端失败。请查看下方服务端返回。SSH 远端项目的终端在远端以普通 shell 运行，不使用本机 bubblewrap。"
    }
    if (allowedButFailed()) {
      if (isolation() === "docker") {
        return "隔离模式为 docker，创建终端失败。常见原因是当前用户无权访问 docker.sock。无 GPU 请改用 bubblewrap；有 GPU 请把运行账号加入 docker 组。"
      }
      if (isolation() === "bubblewrap") {
        return "隔离模式为 bubblewrap，创建终端失败（服务端 POST /pty 返回错误）。可先按下方 A 改用 native 验证；若需继续隔离，再按 B/C 检查 bubblewrap 与内核命名空间。"
      }
      if (failure()) {
        return "远端或本机创建终端失败。下方是服务端返回；SSH 远端终端应是普通 shell，不使用本机 bubblewrap。"
      }
      return `隔离模式为 ${isolation() || "native"}，创建终端失败。请按下方命令查看日志或临时调整隔离模式后重试。`
    }
    if (reason() === "docker-missing") {
      return "已配置 docker 隔离，但当前用户无法使用 Docker。无 GPU 请改用 bubblewrap；有 GPU 请将运行账号加入 docker 组。"
    }
    if (reason() === "disabled") {
      return "服务端未启用平台账号终端。"
    }
    if (reason() === "bubblewrap-unusable") {
      return "已安装 bubblewrap，但无法创建用户命名空间。请按下方命令检查后重启 OneCode 并重新登录。"
    }
    if (runtimeFailure()) {
      return "bubblewrap 终端启动失败。可临时改用 native，或检查 user namespace 相关 sysctl。"
    }
    return "需要安装 bubblewrap 后重启 OneCode 并重新登录。容器部署可使用 ONECODE_TERMINAL_ISOLATION=native。"
  })

  const copy = async () => {
    const text = commands()
      .filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"))
      .join("\n")
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore clipboard failures
    }
  }

  return (
    <Dialog title={title()} class="os-client-terminal-dialog w-full" size="normal">
      <div class="flex flex-col gap-4 px-6 pb-6 pt-0 min-h-0">
        <p class="text-14-regular text-text-weak m-0 leading-6 shrink-0">{description()}</p>
        <Show when={failure()}>
          <pre class="m-0 shrink-0 max-h-28 overflow-y-auto rounded-lg border border-border-weak-base bg-background-weak p-3 text-12-regular text-text-strong leading-5 whitespace-pre-wrap break-all">
            服务端返回：{failure()}
          </pre>
        </Show>
        <Show when={detail()}>
          <pre class="m-0 shrink-0 max-h-24 overflow-y-auto rounded-lg border border-border-weak-base bg-background-weak p-3 text-12-regular text-text-strong leading-5 whitespace-pre-wrap break-all">
            探测详情：{detail()}
          </pre>
        </Show>
        <Show when={hasCommands()}>
          <div class="flex flex-col gap-2 min-w-0 min-h-0">
            <div class="flex items-center justify-between gap-2 shrink-0">
              <strong class="text-13-medium text-text-strong">建议在服务器上执行</strong>
              <Button type="button" size="normal" variant="ghost" onClick={() => void copy()}>
                复制命令
              </Button>
            </div>
            <pre class="m-0 max-h-[36vh] overflow-y-auto rounded-lg border border-border-weak-base bg-background-weak p-3 text-12-regular text-text-strong leading-5 whitespace-pre-wrap break-all">
              {commands().join("\n")}
            </pre>
          </div>
        </Show>
        <p class="text-12-regular text-text-weak m-0 shrink-0">
          {sshRemote()
            ? "远端终端在远端以普通 shell 运行，不使用本机隔离。"
            : "修改环境变量后需重启 OneCode，并在浏览器中重新登录后再打开终端。"}
        </p>
        <div class="flex justify-end shrink-0">
          <Button type="button" variant="primary" size="large" onClick={() => dialog.close()}>
            知道了
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
