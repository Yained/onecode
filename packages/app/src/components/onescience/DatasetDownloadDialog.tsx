import { For, Show, createEffect, createSignal, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import {
  formatDatasetDialogSize,
  datasetCacheLocationPaths,
  type DatasetDownloadCopy,
} from "@/pages/modelscope-download-client"
import type { RuntimeEnvironment } from "@/components/onescience/runtime-environment"

function DatasetCachePathHint(props: {
  paths: string[]
  confirmed?: boolean
  class?: string
}) {
  const paths = () => props.paths.filter((item) => item.trim())
  return (
    <Show when={paths().length > 0}>
      <div class={`os-download-path-hint ${props.class ?? ""}`.trim()}>
        <div class="os-download-path-hint-title">
          {props.confirmed ? "数据集位置" : "数据集实际位置（随 ModelScope 版本可能不同）"}
        </div>
        <ul class="os-download-path-hint-list">
          <For each={paths()}>{(path) => <li class="break-all">{path}</li>}</For>
        </ul>
      </div>
    </Show>
  )
}

export function DatasetDownloadDialog(props: {
  open: boolean
  title: string
  datasetId: string
  targetPath: string
  busy?: boolean
  diskLoading?: boolean
  sizeLoading?: boolean
  availableBytes?: number
  datasetBytes?: number
  actionLabel?: string
  /** Extra disable for the confirm button (e.g. selected ssh target no longer exists). */
  confirmDisabled?: boolean
  /** Download target environment chosen inside this dialog (does not affect the global selection). */
  environment?: RuntimeEnvironment
  environmentSelector?: JSX.Element
  /** Confirmed on-disk paths after a completed download (update dialog). */
  actualPaths?: string[]
  /** Remote directory (ssh cache_dir / scnet target dir). */
  remotePath?: string
  onRemotePathChange?: (value: string) => void
  error?: string
  onClose: () => void
  onConfirm: () => void
}) {
  const actionLabel = () => props.actionLabel ?? "下载"
  const environment = () => props.environment ?? ({ kind: "local" } as const)
  const diskLabel = () => (props.diskLoading ? "加载中..." : formatDatasetDialogSize(props.availableBytes))
  const sizeLabel = () => {
    if (props.sizeLoading) return "加载中..."
    if (props.datasetBytes === undefined) return "无法从魔搭获取数据集大小"
    return formatDatasetDialogSize(props.datasetBytes)
  }
  const cachePathBase = () => {
    if (environment().kind === "ssh") return props.remotePath ?? ""
    if (environment().kind === "scnet") return props.remotePath?.trim() || "（SCNet 默认缓存目录）"
    const suffix = `/${props.datasetId}`
    return props.targetPath.endsWith(suffix) ? props.targetPath.slice(0, -suffix.length) : props.targetPath
  }
  const pathHint = () => {
    const actual = (props.actualPaths ?? []).map((item) => item.trim()).filter(Boolean)
    if (actual.length > 0) return { paths: [...new Set(actual)], confirmed: true }
    return { paths: datasetCacheLocationPaths(cachePathBase(), props.datasetId), confirmed: false }
  }
  const confirmLabel = () => {
    if (props.busy) return environment().kind === "ssh" ? "正在提交到远端..." : "正在提交下载..."
    if (environment().kind === "scnet") return "创建下载任务"
    return actionLabel() === "更新" ? "确认更新" : "确认下载"
  }
  /** Block confirm until ModelScope reports a size (and while that fetch is in flight). */
  const datasetSizeBlocking = () => !!props.sizeLoading || props.datasetBytes === undefined
  /** Local/SSH only: refuse when the estimated dataset would not fit. */
  const spaceInsufficient = () => {
    if (environment().kind === "scnet") return false
    const size = props.datasetBytes
    const available = props.availableBytes
    if (size === undefined || available === undefined || available <= 0) return false
    return size > available
  }
  /** Local/SSH only: refuse when disk space could not be read (SSH down or probe failed). */
  const spaceUnknown = () => {
    if (environment().kind === "scnet") return false
    if (props.diskLoading) return false
    return props.availableBytes === undefined
  }
  const confirmDisabled = () =>
    !!props.busy ||
    !!props.confirmDisabled ||
    (environment().kind === "ssh" && !(props.remotePath ?? "").trim()) ||
    datasetSizeBlocking() ||
    !!props.diskLoading ||
    spaceUnknown() ||
    spaceInsufficient()

  return (
    <Show when={props.open}>
      <Portal>
        <div class="os-modal-backdrop" role="presentation">
          <div class="os-upload-dialog os-download-dialog" onClick={(event) => event.stopPropagation()}>
            <div class="os-upload-head">
              <div>
                <div class="os-eyebrow">{actionLabel()}数据集</div>
                <h2>{props.title}</h2>
              </div>
              <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
            </div>
            <Show when={props.environmentSelector}>
              <div class="os-download-env-row">
                <div class="os-download-env-field">
                  <span class="os-field-label-row">
                    <span class="os-field-label">下载到环境</span>
                  </span>
                  <div>{props.environmentSelector}</div>
                </div>
              </div>
            </Show>
            <Show
              when={environment().kind === "local"}
              fallback={
                <>
                  <label>
                    <span class="os-field-label-row">
                      <span class="os-field-label">
                        {environment().kind === "ssh" ? "远端存储目录" : "SCNet 目标目录"}
                        <span class="os-field-required" aria-hidden="true"> *</span>
                      </span>
                    </span>
                    <input
                      value={props.remotePath ?? ""}
                      placeholder={
                        environment().kind === "ssh" ? "/work/you/modelscope/hub/datasets" : "modelscope/hub/datasets"
                      }
                      onInput={(event) => props.onRemotePathChange?.(event.currentTarget.value)}
                    />
                  </label>
                  <DatasetCachePathHint paths={pathHint().paths} confirmed={pathHint().confirmed} />
                </>
              }
            >
              <p class="os-section-copy">
                确认将 <strong>{props.datasetId}</strong> {actionLabel() === "更新" ? "更新到" : "下载到"}以下路径吗？
              </p>
              <DatasetCachePathHint paths={pathHint().paths} confirmed={pathHint().confirmed} />
            </Show>
            <Show when={pathHint().confirmed}>
              <p class="os-section-copy" data-testid="download-register-guide">
                下载完成不会自动登记。请到 OneData「原始数据」确认接入后再加工或训练。
              </p>
            </Show>
            <Show when={environment().kind === "scnet"}>
              <p class="os-section-copy">
                SCNet 侧无法直接访问 ModelScope。确认后将打开科研开发会话，由 Agent 使用 scnet MCP 工具完成下载与传输。
              </p>
            </Show>
            <div class="os-dataset-download-info" data-insufficient={spaceInsufficient() ? "" : undefined} data-unknown={spaceUnknown() ? "" : undefined}>
              <div class="os-dataset-download-info-row">
                <span>数据集大小（预估）</span>
                <strong>{sizeLabel()}</strong>
              </div>
              <Show when={environment().kind !== "scnet"}>
                <div class="os-dataset-download-info-row">
                  <span>{environment().kind === "ssh" ? "远端可用空间" : "项目路径可用空间"}</span>
                  <strong>{diskLabel()}</strong>
                </div>
              </Show>
            </div>
            <Show when={spaceInsufficient()}>
              <div class="os-upload-error">可用空间不足，无法下载该数据集</div>
            </Show>
            <Show when={spaceUnknown()}>
              <div class="os-upload-error">
                {environment().kind === "ssh" ? "无法获取远端可用空间，暂不可下载" : "无法获取项目路径可用空间，暂不可下载"}
              </div>
            </Show>
            <Show when={!props.sizeLoading && props.datasetBytes === undefined}>
              <div class="os-upload-error">无法从魔搭获取数据集大小，暂不可下载</div>
            </Show>
            <Show when={props.error}>
              <div class="os-upload-error">{props.error}</div>
            </Show>
            <div class="os-upload-actions">
              <button type="button" class="os-button os-button-secondary" onClick={props.onClose} disabled={props.busy}>取消</button>
              <button type="button" class="os-button os-button-primary" onClick={props.onConfirm} disabled={confirmDisabled()}>
                {confirmLabel()}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

export function DatasetDownloadCancelDialog(props: {
  open: boolean
  title: string
  datasetId: string
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Show when={props.open}>
      <Portal>
        <div class="os-modal-backdrop" role="presentation">
          <div class="os-upload-dialog os-download-dialog" onClick={(event) => event.stopPropagation()}>
            <div class="os-upload-head">
              <div>
                <div class="os-eyebrow">取消下载</div>
                <h2>{props.title}</h2>
              </div>
              <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
            </div>
            <p class="os-section-copy">
              确认取消 <strong>{props.datasetId}</strong> 的下载吗？已下载的部分文件将被保留，你可以稍后重新下载。
            </p>
            <div class="os-upload-actions">
              <button type="button" class="os-button os-button-secondary" onClick={props.onClose} disabled={props.busy}>继续下载</button>
              <button type="button" class="os-button os-button-primary" onClick={props.onConfirm} disabled={props.busy}>
                {props.busy ? "正在取消..." : "确认取消"}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}

export function DatasetDownloadDeleteDialog(props: {
  open: boolean
  title: string
  datasetId: string
  copies: DatasetDownloadCopy[]
  selectedKeys: string[]
  onSelectedKeysChange: (keys: string[]) => void
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  // Freeze the copy list while deleting so live store updates don't switch multi→single UI mid-flight.
  const [frozenCopies, setFrozenCopies] = createSignal<DatasetDownloadCopy[] | undefined>()
  createEffect(() => {
    if (!props.open) {
      setFrozenCopies(undefined)
      return
    }
    if (!props.busy) setFrozenCopies(props.copies)
  })
  const copies = () => (props.busy ? frozenCopies() ?? props.copies : props.copies)
  const selected = () => new Set(props.selectedKeys)
  const selectedCopies = () => copies().filter((copy) => selected().has(copy.key))
  const allSelected = () => copies().length > 0 && selectedCopies().length === copies().length
  const partial = () => {
    const items = selectedCopies()
    return items.length > 0 && items.every((copy) => copy.partial)
  }
  const confirmDisabled = () => !!props.busy || selectedCopies().length === 0
  const toggleKey = (key: string) => {
    if (props.busy) return
    const next = new Set(selected())
    if (next.has(key)) next.delete(key)
    else next.add(key)
    props.onSelectedKeysChange([...next])
  }
  const toggleAll = () => {
    if (props.busy) return
    props.onSelectedKeysChange(allSelected() ? [] : copies().map((copy) => copy.key))
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div class="os-modal-backdrop" role="presentation">
          <div class="os-upload-dialog os-download-dialog" onClick={(event) => event.stopPropagation()}>
            <div class="os-upload-head">
              <div>
                <div class="os-eyebrow">{partial() ? "清理残留文件" : "删除数据集"}</div>
                <h2>{props.title}</h2>
              </div>
              <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose} disabled={props.busy}>×</button>
            </div>
            <Show when={props.busy}>
              <p class="os-section-copy">正在删除所选副本…</p>
            </Show>
            <Show when={!props.busy}>
              <p class="os-section-copy">
                {copies().length > 1
                  ? "该数据集已下载到多个环境。请选择要删除的副本，此操作不可恢复。"
                  : partial()
                    ? <>确认清理 <strong>{props.datasetId}</strong> 未完成的下载残留吗？请选择环境后继续。</>
                    : <>请选择要删除 <strong>{props.datasetId}</strong> 的环境。此操作不可恢复。</>}
              </p>
              <Show when={copies().length > 1}>
                <button type="button" class="os-download-copy-all" onClick={toggleAll} disabled={props.busy}>
                  {allSelected() ? "取消全选" : "全选"}
                </button>
              </Show>
              <div class="os-download-copy-list" role="group" aria-label="选择要删除的环境">
                <For each={copies()}>
                  {(copy) => (
                    <button
                      type="button"
                      class="os-download-copy-item"
                      data-selected={selected().has(copy.key) ? "" : undefined}
                      aria-pressed={selected().has(copy.key)}
                      disabled={props.busy}
                      onClick={() => toggleKey(copy.key)}
                    >
                      <span class="os-download-copy-item-title">
                        {copy.label}
                        <Show when={copy.partial}>
                          <span class="os-download-copy-partial"> 未完成</span>
                        </Show>
                      </span>
                      <span class="os-download-copy-item-path">
                        <For each={copy.paths}>
                          {(path) => <span class="os-download-copy-path break-all">{path}</span>}
                        </For>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <div class="os-upload-actions">
              <button type="button" class="os-button os-button-secondary" onClick={props.onClose} disabled={props.busy}>取消</button>
              <button type="button" class="os-button os-button-primary" onClick={props.onConfirm} disabled={confirmDisabled()}>
                {props.busy ? "正在删除..." : partial() ? "确认清理" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
