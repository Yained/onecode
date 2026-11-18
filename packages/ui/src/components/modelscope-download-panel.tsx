import { Show } from "solid-js"
import { Button } from "./button"
import { useI18n } from "../context/i18n"
import type { ModelScopeDownloadProgress } from "../science-metrics"

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function ModelScopeDownloadPanel(props: {
  progress: ModelScopeDownloadProgress
  active?: boolean
  onCancel?: () => void
}) {
  const i18n = useI18n()
  const starting = () => props.active && props.progress.total <= 0
  const percent = () =>
    starting() ? 0 : Math.min(100, Math.max(0, props.progress.percent))

  return (
    <div data-component="modelscope-download-panel" data-starting={starting() ? "" : undefined}>
      <div data-slot="modelscope-download-header">
        <span data-slot="modelscope-download-title">{i18n.t("ui.science.modelscope.download")}</span>
        <div data-slot="modelscope-download-header-actions">
          <Show when={props.active}>
            <span data-slot="modelscope-download-active">{i18n.t("ui.science.modelscope.downloading")}</span>
          </Show>
          <Show when={props.active && props.onCancel}>
            <Button
              size="small"
              variant="ghost"
              data-slot="modelscope-download-cancel"
              onClick={(event: MouseEvent) => {
                event.stopPropagation()
                props.onCancel?.()
              }}
            >
              {i18n.t("ui.science.modelscope.stop")}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={props.progress.file}>
        {(file) => <div data-slot="modelscope-download-file">{file()}</div>}
      </Show>
      <div data-slot="modelscope-download-bar" aria-hidden="true">
        <div data-slot="modelscope-download-bar-fill" style={{ width: `${percent()}%` }} />
      </div>
      <div data-slot="modelscope-download-meta">
        <Show
          when={!starting()}
          fallback={<span>{i18n.t("ui.science.modelscope.preparing")}</span>}
        >
          <span>
            {formatBytes(props.progress.downloaded)} / {formatBytes(props.progress.total)}
          </span>
          <span>{percent().toFixed(1)}%</span>
        </Show>
      </div>
    </div>
  )
}
