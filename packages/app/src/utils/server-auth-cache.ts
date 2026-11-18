import { authFromToken, authTokenFromCredentials } from "./auth-token"

export { AUTH_TOKEN_STORAGE_KEY } from "./auth-token"

export function resolveBrowserAuth(input: { queryToken: string | null; storedToken: string | null }) {
  const queryAuth = authFromToken(input.queryToken)
  if (queryAuth && input.queryToken) return { auth: queryAuth, token: input.queryToken, persist: true }

  const rawQueryToken = input.queryToken?.trim()
  if (rawQueryToken) {
    return {
      auth: { username: "", password: rawQueryToken },
      token: authTokenFromCredentials({ password: rawQueryToken }),
      persist: true,
    }
  }

  const storedAuth = authFromToken(input.storedToken)
  if (storedAuth) return { auth: storedAuth, token: input.storedToken ?? null, persist: false }

  const rawStoredToken = input.storedToken?.trim()
  if (rawStoredToken) {
    return {
      auth: { username: "", password: rawStoredToken },
      token: authTokenFromCredentials({ password: rawStoredToken }),
      persist: false,
    }
  }

  return { auth: undefined, token: null, persist: false }
}
