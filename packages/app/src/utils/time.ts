type TimeKey =
  | "common.time.justNow"
  | "common.time.minutesAgo.short"
  | "common.time.hoursAgo.short"
  | "common.time.daysAgo.short"

type Translate = (key: TimeKey, params?: Record<string, string | number>) => string

function formatRelativeDiff(diffMs: number, t: Translate): string {
  const diffSeconds = Math.floor(Math.max(0, diffMs) / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return t("common.time.justNow")
  if (diffMinutes < 60) return t("common.time.minutesAgo.short", { count: diffMinutes })
  if (diffHours < 24) return t("common.time.hoursAgo.short", { count: diffHours })
  return t("common.time.daysAgo.short", { count: diffDays })
}

export function getRelativeTime(dateString: string, t: Translate): string {
  return formatRelativeDiff(Date.now() - new Date(dateString).getTime(), t)
}

export function getRelativeTimeFromMillis(timestamp: number, t: Translate, now = Date.now()): string {
  return formatRelativeDiff(now - timestamp, t)
}
