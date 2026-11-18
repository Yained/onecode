import { useParams } from "@solidjs/router"
import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"

type RouteParams = {
  dir?: string
  id?: string
}

const RouteParamsContext = createContext<Accessor<RouteParams>>()

export function RouteParamsProvider(props: ParentProps<{ params: Accessor<RouteParams> }>) {
  return <RouteParamsContext.Provider value={props.params}>{props.children}</RouteParamsContext.Provider>
}

export function useRouteParams() {
  const params = useContext(RouteParamsContext)
  if (!params) return useParams()
  return {
    get dir() {
      return params().dir
    },
    get id() {
      return params().id
    },
  }
}
