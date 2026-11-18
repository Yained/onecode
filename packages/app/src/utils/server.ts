import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { authHeadersFromCachedToken, authTokenFromCredentials } from "./auth-token"
import { storedPlatformAuthToken } from "./platform-auth"

export { authFromToken, authTokenFromCredentials } from "./auth-token"

function serverAuthHeader(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`
}

function withAuth(request: Request, server: ServerConnection.HttpBase) {
  const headers = new Headers(request.headers)
  let changed = false
  if (!headers.has("authorization")) {
    const authorization = authHeadersFromCachedToken()?.Authorization ?? serverAuthHeader(server)
    if (authorization) {
      headers.set("authorization", authorization)
      changed = true
    }
  }
  // Explicit platform token so tenant isolation works even when Basic auth is server-admin.
  const platformToken = storedPlatformAuthToken()
  if (platformToken && !headers.has("x-platform-auth-token")) {
    headers.set("x-platform-auth-token", platformToken)
    changed = true
  }
  if (!changed) return request
  return new Request(request, { headers })
}

function runtimeAuthFetch(fetchImpl: typeof fetch | undefined, server: ServerConnection.HttpBase): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init)
    return (fetchImpl ?? fetch)(withAuth(request, server))
  }) as typeof fetch
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  return createOpencodeClient({
    ...config,
    fetch: runtimeAuthFetch(config.fetch, server),
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
    },
    baseUrl: server.url,
  })
}
