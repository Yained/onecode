/** True when every query token fuzzy-matches haystack (case-insensitive).
 * Tokens are whitespace-split. Within a token, characters need only appear in order,
 * not as a contiguous substring — e.g. "突效" matches "突变效应".
 */
export function fuzzyMatchText(haystack: string, query: string) {
  const text = haystack.toLowerCase()
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return true
  return tokens.every((token) => fuzzyMatchToken(text, token))
}

export function fuzzyMatchParts(parts: readonly string[], query: string) {
  return fuzzyMatchText(parts.filter(Boolean).join(" "), query)
}

function fuzzyMatchToken(haystack: string, token: string) {
  if (!token) return true
  if (haystack.includes(token)) return true
  let index = 0
  for (const char of haystack) {
    if (char !== token[index]) continue
    index += 1
    if (index >= token.length) return true
  }
  return false
}
