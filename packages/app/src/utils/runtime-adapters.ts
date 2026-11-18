type RecordValue = Record<string, unknown>

const isRecord = (value: unknown): value is RecordValue => {
  return typeof value === "object" && value !== null
}

export const isDisposable = (value: unknown): value is { dispose: () => void } => {
  return isRecord(value) && typeof value.dispose === "function"
}

export const disposeIfDisposable = (value: unknown) => {
  if (!isDisposable(value)) return
  value.dispose()
}

export const hasSetOption = (value: unknown): value is { setOption: (key: string, next: unknown) => void } => {
  return isRecord(value) && typeof value.setOption === "function"
}

export const setOptionIfSupported = (value: unknown, key: string, next: unknown) => {
  if (!hasSetOption(value)) return
  value.setOption(key, next)
}

/** Apply theme to ghostty-web after open(). setOption is key-encoder only; use renderer.setTheme. */
export const applyTerminalTheme = (value: unknown, theme: Record<string, string>) => {
  if (!isRecord(value)) return
  if (isRecord(value.options)) value.options.theme = theme
  const renderer = value.renderer
  if (!isRecord(renderer) || typeof renderer.setTheme !== "function") return
  renderer.setTheme(theme)
}

export const getHoveredLinkText = (value: unknown) => {
  if (!isRecord(value)) return
  const link = value.currentHoveredLink
  if (!isRecord(link)) return
  if (typeof link.text !== "string") return
  return link.text
}

export const refreshTerminal = (value: unknown) => {
  if (!isRecord(value)) return
  if (typeof value.refresh !== "function") return
  const rows = typeof value.rows === "number" ? value.rows : 0
  if (rows <= 0) return
  value.refresh(0, rows - 1)
}

export const getSpeechRecognitionCtor = <T>(value: unknown): (new () => T) | undefined => {
  if (!isRecord(value)) return
  const ctor =
    typeof value.webkitSpeechRecognition === "function" ? value.webkitSpeechRecognition : value.SpeechRecognition
  if (typeof ctor !== "function") return
  return ctor as new () => T
}
