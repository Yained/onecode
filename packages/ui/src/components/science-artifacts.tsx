import { createMemo, createResource, For, Show } from "solid-js"
import type { ScienceArtifactRef } from "../science-metrics"
import { isPlausibleImagePath } from "../science-metrics"
import { useData } from "../context/data"
import { useDialog } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { useScienceArtifactImageLoader } from "../context/science-artifact-image"
import { getFilename } from "@opencode-ai/core/util/path"
import { ImagePreview } from "./image-preview"

function artifactLabel(item: ScienceArtifactRef) {
  return item.label ?? getFilename(item.path) ?? item.path
}

function isRenderableImageUrl(src: string | undefined) {
  if (!src) return false
  if (src.startsWith("data:")) {
    const payload = src.slice(src.indexOf(",") + 1)
    return payload.length > 32
  }
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:")
}

function useArtifactImageLoader() {
  const data = useData()
  const contextLoader = useScienceArtifactImageLoader()
  return () => data.loadArtifactImage ?? contextLoader
}

function ScienceReportImage(props: { artifact: ScienceArtifactRef }) {
  const dialog = useDialog()
  const loadImage = useArtifactImageLoader()
  const label = () => artifactLabel(props.artifact)
  const [url] = createResource(
    () => ({ path: props.artifact.path, direct: props.artifact.url ?? "" }),
    async ({ path, direct }) => {
      const load = loadImage()
      if (path && load) {
        const loaded = await load(path)
        if (loaded && isRenderableImageUrl(loaded)) return loaded
      }
      if (direct && isRenderableImageUrl(direct)) return direct
    },
  )

  const src = createMemo(() => {
    const value = url()
    if (!value || !isRenderableImageUrl(value)) return
    return value
  })

  const open = () => {
    const value = src()
    if (!value) return
    dialog.show(() => <ImagePreview src={value} alt={label()} />)
  }

  return (
    <Show
      when={src()}
      fallback={
        <Show
          when={url.loading}
          fallback={
            <div data-slot="science-artifact-image-loading" data-state="failed">
              <span data-slot="science-artifact-image-label">{label()}</span>
            </div>
          }
        >
          <div data-slot="science-artifact-image-loading" />
        </Show>
      }
    >
      {(value) => (
        <button type="button" data-slot="science-artifact-image" title={label()} onClick={open}>
          <img data-slot="science-artifact-image-thumb" src={value()} alt={label()} />
          <span data-slot="science-artifact-image-label">{label()}</span>
        </button>
      )}
    </Show>
  )
}

export function ScienceReportImages(props: { artifacts?: ScienceArtifactRef[] }) {
  const i18n = useI18n()
  const images = createMemo(
    () => props.artifacts?.filter((item) => isPlausibleImagePath(item.path)) ?? [],
  )

  return (
    <Show when={images().length > 0}>
      <div data-component="science-report-images">
        <div data-slot="science-report-images-label">{i18n.t("ui.science.reportImages")}</div>
        <div data-slot="science-report-images-grid">
          <For each={images()}>{(artifact) => <ScienceReportImage artifact={artifact} />}</For>
        </div>
      </div>
    </Show>
  )
}

/** @deprecated use ScienceReportImages */
export const ScienceArtifactsPanel = ScienceReportImages
