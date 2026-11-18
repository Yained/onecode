import { Component, For, Show, createEffect, createSignal, onCleanup } from "solid-js"

export type FieldSelectOption = {
  value: string
  label: string
}

type FieldSelectProps = {
  value: string
  placeholder: string
  options: FieldSelectOption[]
  onChange: (value: string) => void
}

export const FieldSelect: Component<FieldSelectProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  let root: HTMLDivElement | undefined

  const selected = () => props.options.find((option) => option.value === props.value)
  const empty = () => !props.value.trim()

  createEffect(() => {
    if (!open()) return
    const handlePointerDown = (event: PointerEvent) => {
      if (root?.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    })
  })

  return (
    <div
      class="os-field-select"
      ref={root}
      data-empty={empty() ? "true" : undefined}
      data-open={open() ? "true" : undefined}
    >
      <button
        type="button"
        class="os-field-select-trigger"
        aria-expanded={open()}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span class="os-field-select-value">{selected()?.label ?? props.placeholder}</span>
        <span class="os-field-select-chevron" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <ul class="os-field-select-menu" role="listbox">
          <For each={props.options}>
            {(option) => (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={props.value === option.value}
                  class="os-field-select-option"
                  data-selected={props.value === option.value ? "true" : undefined}
                  onClick={() => {
                    props.onChange(option.value)
                    setOpen(false)
                  }}
                >
                  {option.label}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
