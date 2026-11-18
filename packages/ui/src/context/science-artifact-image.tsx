import { createContext, useContext, type ParentProps } from "solid-js"

export type ScienceArtifactImageLoader = (path: string) => Promise<string | undefined>

const ctx = createContext<ScienceArtifactImageLoader>()

export function useScienceArtifactImageLoader() {
  return useContext(ctx)
}

export function ScienceArtifactImageProvider(props: ParentProps<{ loadImage: ScienceArtifactImageLoader }>) {
  return <ctx.Provider value={props.loadImage}>{props.children}</ctx.Provider>
}
