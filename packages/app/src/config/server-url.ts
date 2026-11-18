export const defaultOpencodeServerUrl = "http://127.0.0.1:4096"
const legacyDefaultServerUrls = new Set(["http://localhost:4096", "http://127.0.0.1:4096"])

let runtimeServerUrl: string | undefined

function isHttpOrigin(value: string) {
  return /^https?:\/\//i.test(value.trim())
}

/** Desktop / custom-protocol UIs: point relative API helpers at the sidecar HTTP URL. */
export function setRuntimeServerUrl(url: string | undefined) {
  const next = url?.trim().replace(/\/+$/, "")
  runtimeServerUrl = next && isHttpOrigin(next) ? next : undefined
}

export function getRuntimeServerUrl() {
  return runtimeServerUrl
}

export function resolveCurrentServerUrl(input: {
  dev: boolean
  host?: string
  port?: string
  hostname: string
  origin: string
}) {
  if (input.dev) return `http://${input.host ?? "127.0.0.1"}:${input.port ?? "4096"}`
  // Packaged desktop loads UI from oc://renderer — never treat that as the API host.
  if (isHttpOrigin(input.origin)) return input.origin.replace(/\/+$/, "") || input.origin
  if (runtimeServerUrl) return runtimeServerUrl
  return defaultOpencodeServerUrl
}

export function resolveStoredDefaultServerUrl(input: string | null, fallback = defaultOpencodeServerUrl) {
  if (!input) return null
  if (legacyDefaultServerUrls.has(input.replace(/\/+$/, ""))) return fallback
  return input
}
