export type SessionRawChipItem = {
  id: string
  title: string
  uri: string
}

export function resolveSessionRawChipItems(
  rawIds: string[],
  rawList: Array<{ id: string; title: string; uri: string }>,
): SessionRawChipItem[] {
  const byId = new Map(rawList.map((item) => [item.id, item]))
  return rawIds.flatMap((id) => {
    const item = byId.get(id)
    if (!item) return [{ id, title: id, uri: "" }]
    return [{ id: item.id, title: item.title || item.id, uri: item.uri }]
  })
}

export const SESSION_RAW_CHIPS_CHANGED = "onedata-session-chips-changed"
