import { createSignal } from "solid-js"

export const [codePanelVisible, setCodePanelVisible] = createSignal(false)
export const [codePanelTransition, setCodePanelTransition] = createSignal<"show" | "hide" | null>(null)

/** Increments each time the code panel is hidden; used to clear leftover composer state on re-entry. */
let codePanelHideGeneration = 0
export const getCodePanelHideGeneration = () => codePanelHideGeneration

export function updateCodePanelVisible(visible: boolean) {
  const previous = codePanelVisible()
  if (previous === visible) return
  if (!visible) codePanelHideGeneration += 1
  setCodePanelTransition(visible ? "show" : "hide")
  setCodePanelVisible(visible)
  queueMicrotask(() => setCodePanelTransition(null))
}
