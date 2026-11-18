import { Show, createSignal } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { codeSessionHref } from "@/app-routes"
import { stashPendingAction } from "@/workbench/pending-action"
import { storedPlatformAuthSession } from "@/utils/platform-auth"
import { forkPresetCase } from "@/pages/onescience-case-api"

export function requestSharedCaseFork(input: {
  sessionId: string | undefined
  serverUrl: string | undefined
  redirect: string
  navigate: (href: string) => void
  openProject?: (directory: string) => void
  showConfirm: (onConfirm: () => Promise<void>) => void
}) {
  if (!input.sessionId) {
    showToast({ variant: "error", title: "Fork 失败", description: "当前没有可 Fork 的共享案例会话" })
    return
  }
  if (!storedPlatformAuthSession()) {
    stashPendingAction({ type: "fork", sessionId: input.sessionId })
    input.navigate(`/login?redirect=${encodeURIComponent(input.redirect)}`)
    return
  }
  input.showConfirm(async () => {
    if (!input.serverUrl || !input.sessionId) {
      showToast({ variant: "error", title: "Fork 失败", description: "当前没有可 Fork 的共享案例会话" })
      return
    }
    const result = await forkPresetCase(input.serverUrl, input.sessionId)
    input.openProject?.(result.directory)
    const copied = result.filesCopied ?? 0
    showToast({
      variant: "success",
      title: "已 Fork 到工作区",
      description:
        copied > 0
          ? `已复制 ${copied} 个文件到个人 case 目录，可继续编辑与运行。`
          : "会话记录已复制。若工作区缺少代码/数据，请确认服务端已部署共享案例目录（/data/case 或 ONECODE_SHARED_CASES_ROOT）。",
    })
    window.location.assign(codeSessionHref(result.directory, result.sessionId))
  })
}

export function SharedCaseForkConfirmDialog(props: {
  onConfirm: () => Promise<void>
  title?: string
  description?: string
}) {
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  const confirm = async () => {
    if (busy()) return
    setBusy(true)
    setError("")
    try {
      await props.onConfirm()
      dialog.close()
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : "Fork 到个人工作区失败")
    }
  }

  return (
    <Dialog title={props.title ?? "确认 Fork"} fit transition>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <p class="text-14-regular text-text-strong m-0">
          {props.description ?? "将把该官方默认案例复制到你的个人工作区，之后可继续编辑与运行。确认 Fork 吗？"}
        </p>
        <Show when={error()}>
          <p class="os-auth-error m-0">{error()}</p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()} disabled={busy()}>
            取消
          </Button>
          <Button variant="primary" size="large" onClick={() => void confirm()} disabled={busy()}>
            {busy() ? "正在 Fork..." : "确认 Fork"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function SharedCaseForkBanner(props: {
  disabled?: boolean
  busy?: boolean
  onFork: () => void
  inputRef?: (el: HTMLDivElement) => void
}) {
  return (
    <div ref={props.inputRef} class="os-client-shared-case-fork" role="region" aria-label="默认案例只读提示">
      <div class="os-client-shared-case-fork-copy">
        <strong>官方默认案例（只读）</strong>
        <p>可浏览会话内容。开发请 Fork 到个人工作区后再编辑与运行。</p>
      </div>
      <button
        type="button"
        class="os-client-shared-case-fork-cta"
        disabled={props.disabled || props.busy}
        onClick={props.onFork}
      >
        {props.busy ? "正在 Fork..." : "Fork 到我的工作区"}
      </button>
    </div>
  )
}
