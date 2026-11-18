import { createContext, useContext, type ParentProps } from "solid-js"

export type OpenWorkspaceFileFn = (path: string) => void

const FileOpenContext = createContext<OpenWorkspaceFileFn | undefined>()

export function FileOpenProvider(props: ParentProps<{ onOpenFile?: OpenWorkspaceFileFn }>) {
  return <FileOpenContext.Provider value={props.onOpenFile}>{props.children}</FileOpenContext.Provider>
}

export function useFileOpenOptional() {
  return useContext(FileOpenContext)
}
