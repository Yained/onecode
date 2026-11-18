import { Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"

type MolViewer = {
  addModelsAsFrames: (data: string, format: string) => unknown
  setStyle: (sel: object, style: object) => void
  setFrame: (frame: number) => Promise<void> | void
  getNumFrames: () => number
  zoomTo: (sel?: object) => void
  render: () => void
  clear: () => void
  resize: () => void
  removeAllModels: () => void
}

type MolApi = {
  createViewer: (element: HTMLElement, config?: object) => MolViewer
}

async function loadMolApi() {
  const mod = (await import("3dmol")) as unknown as MolApi & { default?: MolApi }
  if (typeof mod.createViewer === "function") return mod
  if (mod.default && typeof mod.default.createViewer === "function") return mod.default
  throw new Error("3dmol createViewer unavailable")
}

export function XyzMoleculeViewer(props: {
  contents: () => string
  path: () => string | undefined
  chrome?: "session" | "workbench"
}) {
  const language = useLanguage()
  const [frame, setFrame] = createSignal(0)
  const [frames, setFrames] = createSignal(1)
  const [error, setError] = createSignal<string>()
  const [style, setStyle] = createSignal<"stick" | "sphere">("stick")
  let host: HTMLDivElement | undefined
  let viewer: MolViewer | undefined
  let gen = 0

  const empty = createMemo(() => !props.contents().trim())

  const applyStyle = () => {
    if (!viewer) return
    if (style() === "sphere") {
      viewer.setStyle({}, { sphere: { scale: 0.35 } })
    } else {
      viewer.setStyle({}, { stick: { radius: 0.15 }, sphere: { scale: 0.25 } })
    }
    viewer.render()
  }

  const mountViewer = async (text: string) => {
    const token = ++gen
    setError(undefined)
    if (!host) return
    try {
      const api = await loadMolApi()
      if (token !== gen || !host) return
      if (!viewer) {
        viewer = api.createViewer(host, {
          backgroundColor:
            getComputedStyle(host).getPropertyValue("--os-file-xyz-bg").trim() ||
            getComputedStyle(host).backgroundColor ||
            "#111111",
          antialias: true,
        })
      } else {
        viewer.removeAllModels()
        viewer.clear()
      }
      viewer.addModelsAsFrames(text, "xyz")
      const count = Math.max(1, viewer.getNumFrames() || 1)
      setFrames(count)
      const next = Math.min(frame(), count - 1)
      setFrame(next)
      await viewer.setFrame(next)
      applyStyle()
      viewer.zoomTo()
      viewer.render()
      viewer.resize()
    } catch (err) {
      if (token !== gen) return
      setError(err instanceof Error ? err.message : language.t("session.file.xyz.error"))
    }
  }

  createEffect(
    on(
      () => [props.path(), props.contents()] as const,
      ([, text]) => {
        if (!text.trim()) {
          setFrames(1)
          setFrame(0)
          setError(undefined)
          return
        }
        void mountViewer(text)
      },
    ),
  )

  createEffect(() => {
    style()
    applyStyle()
  })

  createEffect(() => {
    if (typeof ResizeObserver === "undefined" || !host) return
    const observer = new ResizeObserver(() => viewer?.resize())
    observer.observe(host)
    onCleanup(() => observer.disconnect())
  })

  onCleanup(() => {
    gen += 1
    viewer?.clear()
    viewer = undefined
  })

  const goFrame = async (next: number) => {
    if (!viewer) return
    const clamped = Math.max(0, Math.min(frames() - 1, next))
    setFrame(clamped)
    await viewer.setFrame(clamped)
    viewer.render()
  }

  return (
    <div class="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      <Show
        when={!empty()}
        fallback={
          <div
            classList={{
              "os-file-preview-empty": props.chrome === "workbench",
              "flex flex-1 items-center justify-center px-6 py-10 text-13-regular text-text-weak": props.chrome !== "workbench",
            }}
          >
            {language.t("session.file.xyz.empty")}
          </div>
        }
      >
        <div
          classList={{
            "os-file-xyz-toolbar": true,
            "is-workbench": props.chrome === "workbench",
          }}
        >
          <button type="button" class="os-file-xyz-tool" disabled={frame() <= 0} onClick={() => void goFrame(frame() - 1)}>
            {language.t("session.file.xyz.prev")}
          </button>
          <span class="os-file-xyz-frame">
            {language.t("session.file.xyz.frame", {
              current: frame() + 1,
              total: frames(),
            })}
          </span>
          <button
            type="button"
            class="os-file-xyz-tool"
            disabled={frame() >= frames() - 1}
            onClick={() => void goFrame(frame() + 1)}
          >
            {language.t("session.file.xyz.next")}
          </button>
          <span class="os-file-xyz-sep" aria-hidden="true" />
          <button
            type="button"
            class="os-file-xyz-tool"
            classList={{ "is-active": style() === "stick" }}
            onClick={() => setStyle("stick")}
          >
            {language.t("session.file.xyz.style.stick")}
          </button>
          <button
            type="button"
            class="os-file-xyz-tool"
            classList={{ "is-active": style() === "sphere" }}
            onClick={() => setStyle("sphere")}
          >
            {language.t("session.file.xyz.style.sphere")}
          </button>
        </div>
        <Show when={error()}>
          {(message) => (
            <div
              classList={{
                "os-file-preview-empty": props.chrome === "workbench",
                "flex flex-1 items-center justify-center px-6 py-10 text-13-regular text-text-weak": props.chrome !== "workbench",
              }}
            >
              {message()}
            </div>
          )}
        </Show>
        <div
          ref={host}
          class="os-file-xyz-viewer flex-1 min-h-0 w-full"
          classList={{
            hidden: !!error(),
            "is-workbench": props.chrome === "workbench",
          }}
        />
      </Show>
    </div>
  )
}
