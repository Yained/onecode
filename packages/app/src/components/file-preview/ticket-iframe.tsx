import { Show, createResource } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { resolveHtmlPreviewUrl } from "@/utils/html-preview-url"

export function TicketPreviewIframe(props: {
  path: () => string | undefined
  title: string
  loadingLabel: string
  errorLabel: string
  class?: string
  sandbox?: string
  revision?: () => number
  chrome?: "session" | "workbench"
}) {
  const sdk = useSDK()
  const server = useServer()
  const [previewUrl] = createResource(
    () => ({
      path: props.path() ?? "",
      revision: props.revision?.() ?? 0,
    }),
    async (input) => {
      if (!input.path) return
      const url = await resolveHtmlPreviewUrl({
        baseUrl: sdk.url,
        directory: sdk.directory,
        filePath: input.path,
        username: server.current?.http.username,
        password: server.current?.http.password,
      })
      if (!url) return
      if (!input.revision) return url
      const sep = url.includes("?") ? "&" : "?"
      return `${url}${sep}v=${input.revision}`
    },
  )

  return (
    <Show
      when={previewUrl()}
      fallback={
        <div
          classList={{
            "os-file-preview-empty": props.chrome === "workbench",
            "flex flex-1 items-center justify-center px-6 py-10 text-13-regular text-text-weak": props.chrome !== "workbench",
          }}
        >
          {previewUrl.loading ? props.loadingLabel : props.errorLabel}
        </div>
      }
    >
      {(url) => (
        <iframe
          title={props.title}
          src={url()}
          sandbox={props.sandbox}
          referrerpolicy="no-referrer"
          class={props.class ?? "flex-1 min-h-0 w-full border-0 bg-background-base"}
        />
      )}
    </Show>
  )
}
