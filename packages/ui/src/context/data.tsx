import type { Message, Session, Part, SnapshotFileDiff, SessionStatus, ProviderListResponse } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import type { ScienceArtifactImageLoader } from "./science-artifact-image"

type Data = {
  agent?: {
    name: string
    color?: string
  }[]
  provider?: ProviderListResponse
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: SnapshotFileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
  part_text_accum_delta?: {
    [partID: string]: string
  }
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

export type AbortSessionFn = (sessionID: string) => void

export type HydrateMessagePartsFn = (sessionID: string, messageID: string) => Promise<void>

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    loadArtifactImage?: ScienceArtifactImageLoader
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onAbortSession?: AbortSessionFn
    onHydrateMessageParts?: HydrateMessagePartsFn
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      loadArtifactImage: props.loadArtifactImage,
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      abortSession: props.onAbortSession,
      hydrateMessageParts: props.onHydrateMessageParts,
    }
  },
})
