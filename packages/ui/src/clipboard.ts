let lastClipboardText = ""

export function rememberClipboardText(value: string) {
  if (value) lastClipboardText = value
}

export async function readClipboardTextForPaste() {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (clipboard?.readText) {
    const text = await clipboard.readText().catch(() => "")
    if (text) return text
  }
  return lastClipboardText
}

export async function copyTextToClipboard(value: string) {
  if (!value) return false

  // Prefer Clipboard API: execCommand("copy") fails under modal focus traps
  // (e.g. DropdownMenu) even when it returns true.
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (clipboard?.writeText) {
    const ok = await clipboard.writeText(value).then(
      () => true,
      () => false,
    )
    if (ok) {
      rememberClipboardText(value)
      return true
    }
  }

  const body = typeof document === "undefined" ? undefined : document.body
  if (!body) return false

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", value)
    event.preventDefault()
  }
  document.addEventListener("copy", onCopy)
  const copied = document.execCommand("copy")
  document.removeEventListener("copy", onCopy)
  body.removeChild(textarea)

  if (!copied) return false
  rememberClipboardText(value)
  return true
}

if (typeof document !== "undefined") {
  document.addEventListener("copy", (event) => {
    const text = event.clipboardData?.getData("text/plain") || document.getSelection()?.toString() || ""
    rememberClipboardText(text)
  })
}
