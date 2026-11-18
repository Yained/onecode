type Visibility = "show" | "hide"

/** Default visibility when the user has not set show/hide. */
export function isModelDefaultVisible(input: {
  userVisibility?: Visibility
  providerID: string
  inLatestSet: boolean
  free: boolean
  hasValidReleaseDate: boolean
}) {
  if (input.userVisibility === "hide") return false
  if (input.userVisibility === "show") return true
  // Organization preset should always appear unless the user hid it.
  if (input.providerID === "onescience") return true
  if (input.inLatestSet) return true
  // Free models (e.g. Zen Big Pickle) stay visible even after the 6-month window.
  if (input.free) return true
  if (!input.hasValidReleaseDate) return true
  return false
}
