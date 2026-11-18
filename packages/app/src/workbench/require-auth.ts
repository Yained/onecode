import { stashPendingAction, type PendingAction } from "./pending-action"

export function requirePersonalSpace(input: {
  navigate: (href: string) => void
  action: PendingAction
  isLoggedIn: boolean
  /** Page to return to after login or cancel. Defaults to the current URL. */
  redirect?: string
}) {
  if (input.isLoggedIn) return true
  stashPendingAction(input.action)
  const current =
    typeof location !== "undefined" ? `${location.pathname}${location.search}${location.hash}` : ""
  // Prefer the page that triggered login so cancel restores prior browse context.
  const redirect = encodeURIComponent(
    input.redirect ?? (current.startsWith("/") ? current : "/workspace/capabilities"),
  )
  input.navigate(`/login?redirect=${redirect}`)
  return false
}
