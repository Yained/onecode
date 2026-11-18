import { getViewerID } from "@/utils/viewer-id"

export const VIEWER_HEARTBEAT_MS = 15_000

type ViewClient = {
  view: (input: { sessionID: string; directory?: string; viewerID: string }) => Promise<unknown>
  viewHeartbeat: (input: { sessionID: string; directory?: string; viewerID: string }) => Promise<unknown>
  unview: (input: { sessionID: string; directory?: string; viewerID: string }) => Promise<unknown>
}

type ActiveView = {
  directory: string
  sessionID: string
  timer?: number
}

let client: ViewClient | undefined
let active: ActiveView | undefined
let visibilityBound = false

function clearTimer() {
  if (!active?.timer) return
  window.clearInterval(active.timer)
  active.timer = undefined
}

async function heartbeat() {
  if (!client || !active) return
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return
  await client
    .viewHeartbeat({
      sessionID: active.sessionID,
      directory: active.directory,
      viewerID: getViewerID(),
    })
    .catch(() => undefined)
}

function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return
  visibilityBound = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return
    void heartbeat()
  })
}

export function configureSessionViewer(next: ViewClient) {
  client = next
  bindVisibility()
}

export async function setSessionView(directory: string, sessionID: string | undefined) {
  if (!client) {
    if (!sessionID) {
      active = undefined
      return
    }
    active = { directory, sessionID }
    return
  }

  const previous = active
  if (previous && (previous.directory !== directory || previous.sessionID !== sessionID)) {
    clearTimer()
    await client
      .unview({
        sessionID: previous.sessionID,
        directory: previous.directory,
        viewerID: getViewerID(),
      })
      .catch(() => undefined)
    active = undefined
  }

  if (!sessionID) {
    clearTimer()
    active = undefined
    return
  }

  if (active?.directory === directory && active.sessionID === sessionID) return

  active = { directory, sessionID }
  await client
    .view({
      sessionID,
      directory,
      viewerID: getViewerID(),
    })
    .catch(() => undefined)

  clearTimer()
  active.timer = window.setInterval(() => {
    void heartbeat()
  }, VIEWER_HEARTBEAT_MS)
}
