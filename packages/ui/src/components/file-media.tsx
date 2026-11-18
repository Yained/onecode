import type { FileContent } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createResource, createSignal, Match, on, Show, Switch, type JSX } from "solid-js"
import { useI18n } from "../context/i18n"
import {
  dataUrlFromMediaValue,
  hasMediaValue,
  isBinaryContent,
  mediaKindFromPath,
  normalizeMimeType,
  svgTextFromValue,
} from "../pierre/media"

export type FileMediaOptions = {
  mode?: "auto" | "off"
  path?: string
  current?: unknown
  before?: unknown
  after?: unknown
  deleted?: boolean
  readFile?: (path: string) => Promise<FileContent | undefined>
  loadHtmlPreviewUrl?: (path: string) => Promise<string | undefined>
  onLoad?: () => void
  onError?: (ctx: { kind: "image" | "audio" | "svg" | "html" }) => void
}

function mediaValue(cfg: FileMediaOptions, mode: "image" | "audio") {
  if (cfg.current !== undefined) return cfg.current
  if (mode === "image") return cfg.after ?? cfg.before
  return cfg.after ?? cfg.before
}

export function FileMedia(props: { media?: FileMediaOptions; fallback: () => JSX.Element }) {
  const i18n = useI18n()
  const cfg = () => props.media
  const kind = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off") return
    return mediaKindFromPath(media.path)
  })
  const [htmlView, setHtmlView] = createSignal<"preview" | "source">("preview")

  createEffect(
    on(
      () => cfg()?.path,
      () => setHtmlView("preview"),
      { defer: true },
    ),
  )

  const isBinary = createMemo(() => {
    const media = cfg()
    if (!media || media.mode === "off") return false
    if (kind()) return false
    return isBinaryContent(media.current as any)
  })

  const onLoad = () => props.media?.onLoad?.()

  const deleted = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || !k) return false
    if (media.deleted) return true
    if (k === "svg" || k === "html") return false
    if (media.current !== undefined) return false
    return !hasMediaValue(media.after as any) && hasMediaValue(media.before as any)
  })

  const direct = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || (k !== "image" && k !== "audio")) return
    return dataUrlFromMediaValue(mediaValue(media, k), k)
  })

  const request = createMemo(() => {
    const media = cfg()
    const k = kind()
    if (!media || (k !== "image" && k !== "audio")) return
    if (media.current !== undefined) return
    if (deleted()) return
    if (direct()) return
    if (!media.path || !media.readFile) return

    return {
      key: `${k}:${media.path}`,
      kind: k,
      path: media.path,
      readFile: media.readFile,
      onError: media.onError,
    }
  })

  const [loaded] = createResource(request, async (input) => {
    return input.readFile(input.path).then(
      (result) => {
        const src = dataUrlFromMediaValue(result as any, input.kind)
        if (!src) {
          input.onError?.({ kind: input.kind })
          return { key: input.key, error: true as const }
        }

        return {
          key: input.key,
          src,
          mime: input.kind === "audio" ? normalizeMimeType(result?.mimeType) : undefined,
        }
      },
      () => {
        input.onError?.({ kind: input.kind })
        return { key: input.key, error: true as const }
      },
    )
  })

  const htmlRequest = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "html" || htmlView() !== "preview") return
    if (!media.path || !media.loadHtmlPreviewUrl) return
    return {
      key: media.path,
      path: media.path,
      load: media.loadHtmlPreviewUrl,
      onError: media.onError,
    }
  })

  const [htmlPreview] = createResource(htmlRequest, async (input) => {
    return input.load(input.path).then(
      (src) => {
        if (!src) {
          input.onError?.({ kind: "html" })
          return { key: input.key, error: true as const }
        }
        return { key: input.key, src }
      },
      () => {
        input.onError?.({ kind: "html" })
        return { key: input.key, error: true as const }
      },
    )
  })

  const remote = createMemo(() => {
    const input = request()
    const value = loaded()
    if (!input || !value || value.key !== input.key) return
    return value
  })

  const src = createMemo(() => {
    const value = remote()
    return direct() ?? (value && "src" in value ? value.src : undefined)
  })
  const status = createMemo(() => {
    if (direct()) return "ready" as const
    if (!request()) return "idle" as const
    if (loaded.loading) return "loading" as const
    if (remote()?.error) return "error" as const
    if (src()) return "ready" as const
    return "idle" as const
  })
  const audioMime = createMemo(() => {
    const value = remote()
    return value && "mime" in value ? value.mime : undefined
  })

  const htmlSrc = createMemo(() => {
    const input = htmlRequest()
    const value = htmlPreview()
    if (!input || !value || value.key !== input.key) return
    if ("src" in value) return value.src
  })
  const htmlStatus = createMemo(() => {
    if (!htmlRequest()) return "idle" as const
    if (htmlPreview.loading) return "loading" as const
    if (htmlPreview()?.error) return "error" as const
    if (htmlSrc()) return "ready" as const
    return "idle" as const
  })

  const svgSource = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    return svgTextFromValue(media.current as any)
  })
  const svgSrc = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    return dataUrlFromMediaValue(media.current as any, "svg")
  })
  const svgInvalid = createMemo(() => {
    const media = cfg()
    if (!media || kind() !== "svg") return
    if (svgSource() !== undefined) return
    if (!hasMediaValue(media.current as any)) return
    return [media.path, media.current] as const
  })

  createEffect(
    on(
      svgInvalid,
      (value) => {
        if (!value) return
        cfg()?.onError?.({ kind: "svg" })
      },
      { defer: true },
    ),
  )

  const kindLabel = (value: "image" | "audio" | "html") => {
    if (value === "image") return i18n.t("ui.fileMedia.kind.image")
    if (value === "audio") return i18n.t("ui.fileMedia.kind.audio")
    return i18n.t("ui.fileMedia.kind.html")
  }

  return (
    <Switch>
      <Match when={kind() === "html"}>
        <div class="flex flex-col gap-3 px-6 py-4">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded border border-border-weak-base px-2 py-1 text-12-medium"
              classList={{
                "bg-background-stronger text-text-strong": htmlView() === "preview",
                "bg-background-base text-text-weak": htmlView() !== "preview",
              }}
              onClick={() => setHtmlView("preview")}
            >
              {i18n.t("ui.fileMedia.html.preview")}
            </button>
            <button
              type="button"
              class="rounded border border-border-weak-base px-2 py-1 text-12-medium"
              classList={{
                "bg-background-stronger text-text-strong": htmlView() === "source",
                "bg-background-base text-text-weak": htmlView() !== "source",
              }}
              onClick={() => setHtmlView("source")}
            >
              {i18n.t("ui.fileMedia.html.source")}
            </button>
          </div>
          <Show when={htmlView() === "source"} fallback={
            <Show
              when={htmlSrc()}
              fallback={
                <div class="flex min-h-56 items-center justify-center rounded border border-border-weak-base bg-background-stronger px-6 py-4 text-center text-text-weak">
                  {htmlStatus() === "loading"
                    ? i18n.t("ui.fileMedia.state.loading", { kind: kindLabel("html") })
                    : htmlStatus() === "error"
                      ? i18n.t("ui.fileMedia.state.error", { kind: kindLabel("html") })
                      : i18n.t("ui.fileMedia.state.unavailable", { kind: kindLabel("html") })}
                </div>
              }
            >
              {(value) => (
                <iframe
                  title={cfg()?.path ?? "html-preview"}
                  src={value()}
                  sandbox="allow-scripts"
                  referrerpolicy="no-referrer"
                  class="h-[70vh] w-full rounded border border-border-weak-base bg-background-base"
                  onLoad={onLoad}
                />
              )}
            </Show>
          }>
            {props.fallback()}
          </Show>
        </div>
      </Match>
      <Match when={kind() === "image" || kind() === "audio"}>
        <Show
          when={src()}
          fallback={(() => {
            const media = cfg()
            const k = kind()
            if (!media || (k !== "image" && k !== "audio")) return props.fallback()
            const label = kindLabel(k)

            if (deleted()) {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                  {i18n.t("ui.fileMedia.state.removed", { kind: label })}
                </div>
              )
            }
            if (status() === "loading") {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                  {i18n.t("ui.fileMedia.state.loading", { kind: label })}
                </div>
              )
            }
            if (status() === "error") {
              return (
                <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                  {i18n.t("ui.fileMedia.state.error", { kind: label })}
                </div>
              )
            }
            return (
              <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
                {i18n.t("ui.fileMedia.state.unavailable", { kind: label })}
              </div>
            )
          })()}
        >
          {(value) => {
            const k = kind()
            if (k !== "image" && k !== "audio") return props.fallback()
            if (k === "image") {
              return (
                <div class="flex justify-center bg-background-stronger px-6 py-4">
                  <img
                    src={value()}
                    alt={cfg()?.path}
                    class="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
                    onLoad={onLoad}
                  />
                </div>
              )
            }

            return (
              <div class="flex justify-center bg-background-stronger px-6 py-4">
                <audio class="w-full max-w-xl" controls preload="metadata" onLoadedMetadata={onLoad}>
                  <source src={value()} type={audioMime()} />
                </audio>
              </div>
            )
          }}
        </Show>
      </Match>
      <Match when={kind() === "svg"}>
        {(() => {
          if (svgSource() === undefined && svgSrc() == null) return props.fallback()

          return (
            <div class="flex flex-col gap-4 px-6 py-4">
              <Show when={svgSource() !== undefined}>{props.fallback()}</Show>
              <Show when={svgSrc()}>
                {(value) => (
                  <div class="flex justify-center">
                    <img
                      src={value()}
                      alt={cfg()?.path}
                      class="max-h-[60vh] max-w-full rounded border border-border-weak-base bg-background-base object-contain"
                      onLoad={onLoad}
                    />
                  </div>
                )}
              </Show>
            </div>
          )
        })()}
      </Match>
      <Match when={isBinary()}>
        <div class="flex min-h-56 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <div class="text-14-semibold text-text-strong">
            {cfg()?.path?.split("/").pop() ?? i18n.t("ui.fileMedia.binary.title")}
          </div>
          <div class="text-14-regular text-text-weak">
            {(() => {
              const path = cfg()?.path
              if (!path) return i18n.t("ui.fileMedia.binary.description.default")
              return i18n.t("ui.fileMedia.binary.description.path", { path })
            })()}
          </div>
        </div>
      </Match>
      <Match when={true}>{props.fallback()}</Match>
    </Switch>
  )
}
