import { Show } from "solid-js"

export function CapabilityPager(props: {
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
}) {
  return (
    <Show when={props.totalPages > 1}>
      <nav class="os-client-capability-pager" aria-label="分页">
        <span class="os-client-capability-pager-status">
          第 {props.page} / {props.totalPages} 页 · 共 {props.total} 项
        </span>
        <div class="os-client-capability-pager-controls">
          <button
            type="button"
            disabled={props.page <= 1}
            onClick={() => props.onPageChange(props.page - 1)}
          >
            上一页
          </button>
          <button
            type="button"
            disabled={props.page >= props.totalPages}
            onClick={() => props.onPageChange(props.page + 1)}
          >
            下一页
          </button>
        </div>
      </nav>
    </Show>
  )
}
