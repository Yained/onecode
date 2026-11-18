export const AUTH_TOKEN_STORAGE_KEY = "onecode.settings.dat:authToken"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? ""}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decodeBasicAuthToken(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  }
}

export type AuthCredentialSource = {
  username?: string
  password?: string
}

let runtimeCredentials: AuthCredentialSource | undefined

/** Desktop sidecar (and similar) can register Basic auth when localStorage has no web token. */
export function setAuthenticatedFetchCredentials(credentials: AuthCredentialSource | undefined) {
  runtimeCredentials = credentials?.password ? credentials : undefined
}

export function authHeadersFromCachedToken() {
  if (typeof localStorage !== "undefined") {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
    if (token) return { Authorization: `Basic ${token}` }
  }
  if (runtimeCredentials?.password) {
    return {
      Authorization: `Basic ${authTokenFromCredentials({
        username: runtimeCredentials.username ?? "opencode",
        password: runtimeCredentials.password,
      })}`,
    }
  }
  return undefined
}

function decodeBasicAuthToken(token: string | undefined) {
  if (!token) return
  try {
    return atob(token)
  } catch {
    return
  }
}
