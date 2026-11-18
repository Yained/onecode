import type { LocationChange } from "@solidjs/router"
import { createMemoryHistory, MemoryRouter, type MemoryHistory, type MemoryRouterProps } from "@solidjs/router"
import type { Component } from "solid-js"
import { desktopLocationPath } from "./desktop-location-path"

export { desktopLocationPath }

/** Memory history that starts on the current window URL (e.g. /login after auth redirect). */
export function createDesktopMemoryHistory(
  loc: Pick<Location, "pathname" | "search" | "hash"> = window.location,
  createHistory: () => MemoryHistory = createMemoryHistory,
): MemoryHistory {
  const history = createHistory()
  const initial = desktopLocationPath(loc)
  if (initial !== "/") {
    history.set({ value: initial, replace: true } satisfies LocationChange)
  }
  return history
}

export const DesktopMemoryRouter: Component<MemoryRouterProps> = (props) => {
  return <MemoryRouter {...props} history={props.history ?? createDesktopMemoryHistory()} />
}
