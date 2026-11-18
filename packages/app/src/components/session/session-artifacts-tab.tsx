import { For, Show } from "solid-js"
import { createMemo, createResource } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useData } from "@opencode-ai/ui/context/data"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useScienceArtifactImageLoader } from "@opencode-ai/ui/context"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import { getFilename } from "@opencode-ai/core/util/path"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getCachedArtifactImage, setCachedArtifactImage } from "@/utils/artifact-image-cache"
import { resolveHtmlPreviewUrl } from "@/utils/html-preview-url"
import { collectSessionArtifacts, isHtmlArtifactPath, type SessionArtifact } from "@/utils/session-artifacts"

function bucketSource(tool: string | undefined) {
  if (tool === "read") return "read"
  if (tool === "bash") return "bash"
  if (tool === "science") return "science"
  if (tool === "markdown") return "markdown"
  return "other"
}

function useArtifactImageLoader() {
  const data = useData()
  const contextLoader = useScienceArtifactImageLoader()
  return () => data.loadArtifactImage ?? contextLoader
}

function isHtmlArtifact(artifact: SessionArtifact) {
  return artifact.mime === "text/html" || isHtmlArtifactPath(artifact.imagePath) || isHtmlArtifactPath(artifact.filename)
}

function ArtifactHtmlPreview(props: { artifact: SessionArtifact; name: string }) {
  const sdk = useSDK()
  const server = useServer()
  const [src] = createResource(
    () => props.artifact.imagePath ?? "",
    async (path) => {
      if (!path) return
      return resolveHtmlPreviewUrl({
        baseUrl: sdk.url,
        directory: sdk.directory,
        filePath: path,
        username: server.current?.http.username,
        password: server.current?.http.password,
      })
    },
  )

  return (
    <Show
      when={src()}
      fallback={
        <div class="w-full h-56 flex items-center justify-center bg-background-stronger text-12-regular text-text-weak px-4 text-center">
          <Show when={src.loading} fallback={props.name}>
            {props.name}
          </Show>
        </div>
      }
    >
      {(url) => (
        <iframe
          title={props.name}
          src={url()}
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
          class="w-full h-72 bg-background-stronger border-0"
        />
      )}
    </Show>
  )
}

function ArtifactPreview(props: {
  artifact: SessionArtifact
  name: string
  onOpen: (url: string, alt?: string) => void
}) {
  const loader = useArtifactImageLoader()
  const directUrl = () => props.artifact.url
  const imagePath = () => props.artifact.imagePath
  const cachedUrl = () => {
    const path = imagePath()
    if (!path) return
    return getCachedArtifactImage(path)
  }
  const [resolvedUrl] = createResource(
    () => ({ url: directUrl(), path: imagePath() ?? "" }),
    async ({ url, path }) => {
      if (path) {
        const hit = getCachedArtifactImage(path)
        if (hit) return hit
      }
      const load = loader()
      if (path && load) {
        const loaded = await load(path)
        if (loaded) {
          setCachedArtifactImage(path, loaded)
          return loaded
        }
      }
      if (url) return url
    },
  )
  const src = () => cachedUrl() ?? resolvedUrl() ?? directUrl()

  return (
    <Show when={isHtmlArtifact(props.artifact)} fallback={
      <Show
        when={src()}
        fallback={
          <div class="w-full h-40 flex items-center justify-center bg-background-stronger text-12-regular text-text-weak px-4 text-center">
            <Show when={resolvedUrl.loading} fallback={props.name}>
              {props.name}
            </Show>
          </div>
        }
      >
        {(url) => (
          <button type="button" class="block w-full text-left" onClick={() => props.onOpen(url(), props.name)}>
            <img src={url()} alt={props.name} class="w-full max-h-72 object-contain bg-background-stronger" />
          </button>
        )}
      </Show>
    }>
      <ArtifactHtmlPreview artifact={props.artifact} name={props.name} />
    </Show>
  )
}

function artifactSourceLabel(artifact: SessionArtifact, t: ReturnType<typeof useLanguage>["t"]) {
  const key = `session.artifacts.source.${bucketSource(artifact.tool)}` as const
  return t(key)
}

function artifactTimeLabel(timestamp: number | undefined, language: ReturnType<typeof useLanguage>) {
  if (!timestamp) return language.t("session.artifacts.time.unknown")
  const relativeNow = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (relativeNow < minute) return language.t("common.time.justNow")
  if (relativeNow < hour) return language.t("common.time.minutesAgo.short", { count: Math.floor(relativeNow / minute) })
  if (relativeNow < day) return language.t("common.time.hoursAgo.short", { count: Math.floor(relativeNow / hour) })
  if (relativeNow < 7 * day) return language.t("common.time.daysAgo.short", { count: Math.floor(relativeNow / day) })
  return new Intl.DateTimeFormat(language.intl(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp))
}

function artifactTimeBucket(timestamp: number | undefined) {
  if (!timestamp) return "unknown"
  const now = new Date()
  const value = new Date(timestamp)
  const sameDay =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate()
  if (sameDay) return "today"

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const sameYesterday =
    yesterday.getFullYear() === value.getFullYear() &&
    yesterday.getMonth() === value.getMonth() &&
    yesterday.getDate() === value.getDate()
  if (sameYesterday) return "yesterday"

  const diff = now.getTime() - value.getTime()
  if (diff < 7 * 24 * 60 * 60 * 1000) return "week"
  return "older"
}

function artifactTimeBucketLabel(bucket: string, t: ReturnType<typeof useLanguage>["t"]) {
  const key = `session.artifacts.group.${bucket}` as const
  return t(key)
}

export function SessionArtifactsTab(props: { onOpenFile?: (path: string) => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const loader = useArtifactImageLoader()
  const artifacts = useSessionArtifacts()
  const timeGroups = createMemo(() => {
    const groups = new Map<string, SessionArtifact[]>()
    for (const artifact of artifacts()) {
      const bucket = artifactTimeBucket(artifact.time)
      const list = groups.get(bucket) ?? []
      list.push(artifact)
      groups.set(bucket, list)
    }
    return ["today", "yesterday", "week", "older", "unknown"]
      .map((bucket) => ({
        bucket,
        label: artifactTimeBucketLabel(bucket, language.t),
        items: groups.get(bucket) ?? [],
      }))
      .filter((group) => group.items.length > 0)
  })
  const sourceGroups = createMemo(() => {
    const groups = new Map<string, SessionArtifact[]>()
    for (const artifact of artifacts()) {
      const bucket = bucketSource(artifact.tool)
      const list = groups.get(bucket) ?? []
      list.push(artifact)
      groups.set(bucket, list)
    }
    return ["read", "bash", "science", "markdown", "other"]
      .map((bucket) => ({
        bucket,
        label: language.t(`session.artifacts.source.${bucket}` as const),
        items: groups.get(bucket) ?? [],
      }))
      .filter((group) => group.items.length > 0)
  })

  const openImage = (url: string, alt?: string) => {
    dialog.show(() => <ImagePreview src={url} alt={alt} />)
  }

  const previewArtifact = (artifact: SessionArtifact, name: string) => {
    if (artifact.url) {
      openImage(artifact.url, name)
      return
    }
    const path = artifact.imagePath
    const load = loader()
    if (!path || !load) return
    void load(path).then((url) => {
      if (url) openImage(url, name)
    })
  }

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <div class="px-4 py-3 border-b border-border-weaker-base shrink-0">
        <div class="flex items-center justify-between gap-3">
          <div class="text-14-medium text-text-strong">{language.t("session.tab.artifacts")}</div>
          <Show when={artifacts().length > 0}>
            <div class="text-12-medium text-text-weak">{artifacts().length}</div>
          </Show>
        </div>
        <div class="text-12-regular text-text-weak mt-1">{language.t("session.artifacts.description")}</div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <Show
          when={artifacts().length > 0}
          fallback={<div class="text-12-regular text-text-weak py-8 text-center">{language.t("session.artifacts.empty")}</div>}
        >
          <div class="flex flex-col gap-6">
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <For each={timeGroups()}>
                {(group) => (
                  <div class="rounded-lg border border-border-weaker-base bg-background-base px-3 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-12-medium text-text-strong">{group.label}</div>
                      <div class="rounded-full border border-border-weaker-base bg-background-stronger px-2 py-0.5 text-11-medium text-text-weak">
                        {group.items.length}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <For each={sourceGroups()}>
                {(group) => (
                  <div class="rounded-lg border border-border-weaker-base bg-background-base px-3 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-12-medium text-text-strong">{group.label}</div>
                      <div class="rounded-full border border-border-weaker-base bg-background-stronger px-2 py-0.5 text-11-medium text-text-weak">
                        {group.items.length}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <For each={timeGroups()}>
              {(group) => (
                <section class="flex flex-col gap-3">
                  <div class="flex items-center gap-2">
                    <div class="text-13-medium text-text-strong">{group.label}</div>
                    <div class="rounded-full border border-border-weaker-base bg-background-stronger px-2 py-0.5 text-11-medium text-text-weak">
                      {group.items.length}
                    </div>
                  </div>
                  <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <For each={group.items}>
                      {(artifact, index) => {
                        const name = () => artifact.filename ?? getFilename(artifact.imagePath ?? artifact.source ?? "") ?? language.t("session.artifacts.image")
                        const imagePath = () => artifact.imagePath
                        const scriptPath = () => artifact.scriptPath
                        const sourceLabel = () => artifactSourceLabel(artifact, language.t)
                        const timeLabel = () => artifactTimeLabel(artifact.time, language)
                        return (
                          <article class="rounded-lg border border-border-weaker-base bg-background-base overflow-hidden">
                            <ArtifactPreview artifact={artifact} name={name()} onOpen={openImage} />
                            <div class="px-3 py-3 flex flex-col gap-2.5">
                              <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0 flex-1">
                                  <div class="text-13-medium text-text-strong truncate">{name()}</div>
                                  <div class="text-11-regular text-text-weak mt-1">{timeLabel()}</div>
                                </div>
                                <div class="text-11-regular text-text-weak shrink-0">#{index() + 1}</div>
                              </div>
                              <div class="flex flex-wrap gap-2">
                                <div class="rounded-full border border-border-weaker-base bg-background-stronger px-2 py-0.5 text-11-medium text-text-weak">
                                  {sourceLabel()}
                                </div>
                                <Show when={artifact.mime}>
                                  <div class="rounded-full border border-border-weaker-base bg-background-stronger px-2 py-0.5 text-11-medium text-text-weak">
                                    {artifact.mime === "text/html" ? "html" : artifact.mime.replace("image/", "")}
                                  </div>
                                </Show>
                              </div>
                              <Show when={scriptPath()}>
                                <div class="text-12-regular text-text-weak break-all line-clamp-2">{scriptPath()}</div>
                              </Show>
                              <Show when={artifact.source && !scriptPath()}>
                                <div class="text-12-regular text-text-weak break-all line-clamp-2">{artifact.source}</div>
                              </Show>
                              <Show when={artifact.source && scriptPath() && artifact.source !== scriptPath()}>
                                <div class="text-11-regular text-text-weak break-all line-clamp-2">{artifact.source}</div>
                              </Show>
                              <div class="flex flex-wrap gap-2">
                                <Show when={imagePath() && props.onOpenFile}>
                                  <Button
                                    type="button"
                                    size="small"
                                    variant="secondary"
                                    onClick={() => {
                                      const path = imagePath()
                                      if (!path) return
                                      props.onOpenFile?.(path)
                                    }}
                                  >
                                    {isHtmlArtifact(artifact)
                                      ? language.t("session.artifacts.openHtml")
                                      : language.t("session.artifacts.openImage")}
                                  </Button>
                                </Show>
                                <Show when={scriptPath() && props.onOpenFile}>
                                  <Button
                                    type="button"
                                    size="small"
                                    variant="secondary"
                                    onClick={() => {
                                      const path = scriptPath()
                                      if (!path) return
                                      props.onOpenFile?.(path)
                                    }}
                                  >
                                    {language.t("session.artifacts.openScript")}
                                  </Button>
                                </Show>
                                <Show when={!isHtmlArtifact(artifact) && (imagePath() || artifact.url)}>
                                  <Button
                                    type="button"
                                    size="small"
                                    variant="ghost"
                                    onClick={() => previewArtifact(artifact, name())}
                                  >
                                    {language.t("session.artifacts.preview")}
                                  </Button>
                                </Show>
                              </div>
                            </div>
                          </article>
                        )
                      }}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

export function useSessionArtifacts() {
  const sync = useSync()
  const { params } = useSessionLayout()
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const artifacts = createMemo(
    () => collectSessionArtifacts(messages(), sync.data.part),
    undefined,
    {
      equals: (prev, next) => {
        if (!prev || !next) return prev === next
        if (prev.length !== next.length) return false
        return prev.every((item, index) => item.id === next[index]?.id)
      },
    },
  )
  return artifacts
}
