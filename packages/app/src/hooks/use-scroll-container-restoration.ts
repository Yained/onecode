import { onCleanup, onMount } from "solid-js"

const scrollByKey = new Map<string, number>()
let pendingRestorePath: string | undefined
let listening = false

function normalizePath(pathname: string) {
  if (!pathname || pathname === "") return "/"
  return pathname
}

function ensurePopStateListener() {
  if (listening || typeof window === "undefined") return
  listening = true
  window.addEventListener("popstate", () => {
    // URL is already updated when popstate fires.
    pendingRestorePath = normalizePath(window.location.pathname)
  })
}

/** Save/restore scrollTop for an inner overflow container across SPA navigations. */
export function useScrollContainerRestoration(key: string, getEl: () => HTMLElement | undefined) {
  ensurePopStateListener()

  const persist = () => {
    const el = getEl()
    if (!el) return
    scrollByKey.set(key, el.scrollTop)
  }

  const restore = () => {
    const el = getEl()
    if (!el) return
    const top = scrollByKey.get(key)
    if (top === undefined || top <= 0) return
    el.scrollTop = top
  }

  onMount(() => {
    const el = getEl()
    if (!el) return

    const shouldRestore = pendingRestorePath === key
    if (shouldRestore) pendingRestorePath = undefined

    if (shouldRestore) {
      restore()
      requestAnimationFrame(restore)
    }

    el.addEventListener("scroll", persist, { passive: true })
    onCleanup(() => {
      persist()
      el.removeEventListener("scroll", persist)
    })
  })
}
