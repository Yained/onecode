import { authenticatedFetch } from "@/utils/authenticated-fetch"

function oneScienceApiBaseUrl(serverUrl: string) {
  try {
    return new URL(serverUrl).toString().replace(/\/$/, "")
  } catch {
    return serverUrl.replace(/\/$/, "")
  }
}

async function restoreCase(serverUrl: string, sessionId: string, fork: boolean) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/case/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, fork }),
  })

  if (!response.ok) {
    let detail = ""
    try {
      const body = (await response.json()) as { error?: string; message?: string; data?: { message?: string } }
      detail = body.error || body.message || body.data?.message || ""
    } catch {
      try {
        detail = (await response.text()).trim()
      } catch {
        detail = ""
      }
    }
    const prefix = fork ? "Fork 到个人工作区失败" : "恢复共享案例失败"
    throw new Error(detail ? `${prefix}: ${detail}` : prefix)
  }
  return (await response.json()) as { restored: boolean; sessionId: string; directory: string; filesCopied?: number }
}

export function forkPresetCase(serverUrl: string, sessionId: string) {
  return restoreCase(serverUrl, sessionId, true)
}

export function restoreSharedPresetCase(serverUrl: string, sessionId: string) {
  return restoreCase(serverUrl, sessionId, false)
}

/** Returns true when the preset session exists and is not archived under the shared cases root. */
export async function presetCaseSessionAvailable(input: {
  serverUrl: string
  sessionId: string
  directory: string
}) {
  const url = new URL(`${oneScienceApiBaseUrl(input.serverUrl)}/session/${encodeURIComponent(input.sessionId)}`)
  url.searchParams.set("directory", input.directory)
  const response = await authenticatedFetch(url.toString())
  if (response.status === 404) return false
  if (!response.ok) return false
  try {
    const body = (await response.json()) as {
      time?: { archived?: number | null }
      data?: { time?: { archived?: number | null } }
    }
    const archived = body.time?.archived ?? body.data?.time?.archived
    return archived == null
  } catch {
    return false
  }
}
