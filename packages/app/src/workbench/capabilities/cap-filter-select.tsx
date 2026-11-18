import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"

export type CapFilterOption = {
  value: string
  label: string
}

export function CapFilterSelect(props: {
  value: string
  placeholder: string
  options: CapFilterOption[]
  uploadLabel?: string
  "aria-label": string
  onFocusTab?: () => void
  onChange: (value: string) => void
  onUpload?: () => void
}) {
  const [open, setOpen] = createSignal(false)
  let root: HTMLDivElement | undefined

  const selectedLabel = () => props.options.find((option) => option.value === props.value)?.label ?? ""
  const empty = () => !props.value

  createEffect(() => {
    if (!open()) return
    const onPointerDown = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  return (
    <div
      ref={root}
      class="os-client-capability-filter-select"
      data-empty={empty() ? "true" : "false"}
      data-open={open() ? "true" : "false"}
    >
      <button
        type="button"
        class="os-client-capability-filter-select-trigger"
        aria-label={props["aria-label"]}
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={(event) => {
          event.stopPropagation()
          props.onFocusTab?.()
          setOpen((current) => !current)
        }}
      >
        <span class="os-client-capability-filter-select-value">
          {empty() ? props.placeholder : selectedLabel()}
        </span>
        <span class="os-client-capability-filter-select-chevron" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <div class="os-client-capability-filter-select-menu" role="listbox" aria-label={props["aria-label"]}>
          <Show when={props.uploadLabel && props.onUpload}>
            <button
              type="button"
              class="os-client-capability-filter-select-option"
              role="option"
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                props.onUpload?.()
              }}
            >
              {props.uploadLabel}
            </button>
          </Show>
          <For each={props.options}>
            {(option) => (
              <button
                type="button"
                class="os-client-capability-filter-select-option"
                classList={{ "is-selected": option.value === props.value }}
                role="option"
                aria-selected={option.value === props.value}
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                  props.onChange(option.value)
                }}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
