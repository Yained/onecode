import { authHeadersFromCachedToken } from "./auth-token"

export {
  authHeadersFromCachedToken,
  setAuthenticatedFetchCredentials,
  type AuthCredentialSource,
} from "./auth-token"

export function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  const auth = authHeadersFromCachedToken()
  if (auth && !headers.has("authorization")) headers.set("authorization", auth.Authorization)
  return fetch(input, { ...init, headers })
}
