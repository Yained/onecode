import { createMemo } from "solid-js"
import { codeEntryWorkspaceDirectory, codeWorkspaceRecentProjects, configuredCodeDefaultDirectory } from "@/app-routes"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { defaultPlatformProjectDirectory, storedPlatformAuthSession } from "@/utils/platform-auth"

/** Same project the welcome env bar / lastCode picker currently targets. */
export function resolveWorkbenchProjectDirectory(input: {
  path: Parameters<typeof codeEntryWorkspaceDirectory>[0]["path"]
  recent: Parameters<typeof codeEntryWorkspaceDirectory>[0]["recent"]
  lastCodeWorkspace?: string
}) {
  return (
    codeEntryWorkspaceDirectory(input) ||
    defaultPlatformProjectDirectory(storedPlatformAuthSession()) ||
    configuredCodeDefaultDirectory(document, input.path) ||
    ""
  )
}

export function useWorkbenchProjectDirectory() {
  const sync = useGlobalSync()
  const server = useServer()
  return createMemo(() =>
    resolveWorkbenchProjectDirectory({
      path: sync.data.path,
      recent: codeWorkspaceRecentProjects(sync.data.project),
      lastCodeWorkspace: server.projects.lastCode(),
    }),
  )
}
