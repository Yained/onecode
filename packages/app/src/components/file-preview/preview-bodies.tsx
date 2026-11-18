import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { parseCsv } from "@/utils/csv"
import { PreviewToggleBar } from "./preview-toggle"
import { TicketPreviewIframe } from "./ticket-iframe"
import { XyzMoleculeViewer } from "./xyz-viewer"

export type FileSourceEditor = {
  draft: () => string
  setDraft: (value: string) => void
  textareaRef?: (el: HTMLTextAreaElement) => void
  class?: string
}

function SourcePane(props: {
  contents: () => string
  renderSource: (source: string) => any
  editSource?: FileSourceEditor
}) {
  return (
    <Show
      when={props.editSource}
      fallback={<ScrollView class="h-full">{props.renderSource(props.contents())}</ScrollView>}
    >
      {(editor) => (
        <textarea
          ref={(el) => editor().textareaRef?.(el)}
          class={editor().class ?? "flex-1 min-h-0 w-full resize-none bg-background-base px-4 py-3 text-13-regular text-text-strong font-mono outline-none border-0"}
          value={editor().draft()}
          onInput={(event) => editor().setDraft(event.currentTarget.value)}
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
        />
      )}
    </Show>
  )
}

export function HtmlFilePreview(props: {
  path: () => string | undefined
  contents: () => string
  renderSource: (source: string) => any
  editSource?: FileSourceEditor
  previewRevision?: () => number
  chrome?: "session" | "workbench"
}) {
  const language = useLanguage()
  const [view, setView] = createSignal<"preview" | "source">("preview")

  createEffect(
    on(
      props.path,
      () => setView("preview"),
      { defer: true },
    ),
  )

  return (
    <div class="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      <PreviewToggleBar
        view={view}
        setView={setView}
        previewLabel={language.t("session.file.preview.preview")}
        sourceLabel={language.t("session.file.preview.source")}
        chrome={props.chrome}
      />
      <Show
        when={view() === "source"}
        fallback={
          <TicketPreviewIframe
            path={props.path}
            revision={props.previewRevision}
            chrome={props.chrome}
            title={props.path() ?? "html-preview"}
            loadingLabel={language.t("session.file.html.loading")}
            errorLabel={language.t("session.file.html.error")}
            sandbox="allow-scripts"
          />
        }
      >
        <SourcePane contents={props.contents} renderSource={props.renderSource} editSource={props.editSource} />
      </Show>
    </div>
  )
}

export function MarkdownFilePreview(props: {
  path: () => string | undefined
  contents: () => string
  renderSource: (source: string) => any
  editSource?: FileSourceEditor
  chrome?: "session" | "workbench"
}) {
  const language = useLanguage()
  const [view, setView] = createSignal<"preview" | "source">("preview")

  createEffect(
    on(
      props.path,
      () => setView("preview"),
      { defer: true },
    ),
  )

  return (
    <div class="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      <PreviewToggleBar
        view={view}
        setView={setView}
        previewLabel={language.t("session.file.preview.preview")}
        sourceLabel={language.t("session.file.preview.source")}
        chrome={props.chrome}
      />
      <Show
        when={view() === "source"}
        fallback={
          <ScrollView class="h-full">
            <div classList={{ "px-6 py-4": true, "os-file-md-preview": props.chrome === "workbench" }}>
              <Markdown text={props.contents()} cacheKey={props.path() ?? "markdown-preview"} class="text-14-regular" />
            </div>
          </ScrollView>
        }
      >
        <SourcePane contents={props.contents} renderSource={props.renderSource} editSource={props.editSource} />
      </Show>
    </div>
  )
}

export function CsvFilePreview(props: {
  path: () => string | undefined
  contents: () => string
  renderSource: (source: string) => any
  editSource?: FileSourceEditor
  chrome?: "session" | "workbench"
}) {
  const language = useLanguage()
  const [view, setView] = createSignal<"preview" | "source">("preview")
  const table = createMemo(() => parseCsv(props.contents()))

  createEffect(
    on(
      props.path,
      () => setView("preview"),
      { defer: true },
    ),
  )

  return (
    <div class="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      <PreviewToggleBar
        view={view}
        setView={setView}
        previewLabel={language.t("session.file.preview.preview")}
        sourceLabel={language.t("session.file.preview.source")}
        chrome={props.chrome}
      />
      <Show
        when={view() === "source"}
        fallback={
          <Show
            when={table().headers.length > 0}
            fallback={
              <div class="flex flex-1 items-center justify-center px-6 py-10 text-13-regular text-text-weak">
                {language.t("session.file.csv.empty")}
              </div>
            }
          >
            <ScrollView class="h-full">
              <div classList={{ "px-4 py-4 overflow-x-auto": true, "os-file-csv-preview": props.chrome === "workbench" }}>
                <table class="min-w-full border-collapse text-12-regular os-file-csv-table">
                  <thead>
                    <tr class="border-b border-border-weaker-base bg-background-stronger">
                      <For each={table().headers}>
                        {(header) => (
                          <th class="px-3 py-2 text-left text-12-medium text-text-strong whitespace-nowrap">{header}</th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={table().rows}>
                      {(row) => (
                        <tr class="border-b border-border-weaker-base">
                          <For each={row}>
                            {(cell) => <td class="px-3 py-2 text-text-strong whitespace-nowrap align-top">{cell}</td>}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </ScrollView>
          </Show>
        }
      >
        <SourcePane contents={props.contents} renderSource={props.renderSource} editSource={props.editSource} />
      </Show>
    </div>
  )
}

export function PdfFilePreview(props: {
  path: () => string | undefined
  chrome?: "session" | "workbench"
}) {
  const language = useLanguage()
  return (
    <div class="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      <TicketPreviewIframe
        path={props.path}
        chrome={props.chrome}
        title={props.path() ?? "pdf-preview"}
        loadingLabel={language.t("session.file.pdf.loading")}
        errorLabel={language.t("session.file.pdf.error")}
        class="flex-1 min-h-0 w-full border-0 bg-background-base os-file-pdf-viewer"
      />
    </div>
  )
}

export function XyzFilePreview(props: {
  path: () => string | undefined
  contents: () => string
  renderSource: (source: string) => any
  editSource?: FileSourceEditor
  chrome?: "session" | "workbench"
}) {
  const language = useLanguage()
  const [view, setView] = createSignal<"preview" | "source">("preview")

  createEffect(
    on(
      props.path,
      () => setView("preview"),
      { defer: true },
    ),
  )

  return (
    <div class="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      <PreviewToggleBar
        view={view}
        setView={setView}
        previewLabel={language.t("session.file.preview.preview")}
        sourceLabel={language.t("session.file.preview.source")}
        chrome={props.chrome}
      />
      <Show when={view() === "source"} fallback={<XyzMoleculeViewer path={props.path} contents={props.contents} chrome={props.chrome} />}>
        <SourcePane contents={props.contents} renderSource={props.renderSource} editSource={props.editSource} />
      </Show>
    </div>
  )
}
