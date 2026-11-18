/** Browser path for oc://renderer/... or http(s) — used to seed MemoryRouter. */
export function desktopLocationPath(loc: Pick<Location, "pathname" | "search" | "hash">) {
  const path = `${loc.pathname || "/"}${loc.search || ""}${loc.hash || ""}`
  return path.startsWith("/") ? path : `/${path}`
}
