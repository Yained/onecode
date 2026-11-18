import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { getFilename } from "@opencode-ai/core/util/path"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { remoteWorkspaceFor, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import { runtimeEnvironmentFor, runtimeEnvironmentRevision } from "@/components/onescience/runtime-environment"

export function DialogEditProject(props: { project: LocalProject }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const folderName = createMemo(() => getFilename(props.project.worktree))
  const defaultName = createMemo(() => props.project.name || folderName())
  const pathHint = createMemo(() => {
    remoteWorkspaceRevision()
    runtimeEnvironmentRevision()
    const env = runtimeEnvironmentFor(props.project.worktree)
    const remote = remoteWorkspaceFor(props.project.worktree)?.remotePath?.trim()
    if (env.kind === "ssh" && remote) {
      return remote.endsWith("/") ? remote : `${remote}/`
    }
    const path = props.project.worktree.replace(/\\/g, "/").replace(/\/+$/, "")
    return `${path}/`
  })

  const [store, setStore] = createStore({ name: defaultName() })

  const canSubmit = createMemo(() => {
    const next = store.name.trim()
    if (!next) return false
    return next !== defaultName()
  })

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const trimmed = store.name.trim()
      const name = trimmed === folderName() ? "" : trimmed

      if (props.project.id && props.project.id !== "global") {
        await globalSDK.client.project.update({
          projectID: props.project.id,
          directory: props.project.worktree,
          name,
          // Keep existing icon / startup — this dialog only renames.
          icon: {
            color: props.project.icon?.color || "",
            override: props.project.icon?.override || "",
          },
          commands: { start: props.project.commands?.start ?? "" },
        })
        dialog.close()
        return
      }

      globalSync.project.meta(props.project.worktree, {
        name,
        icon: props.project.icon,
        commands: props.project.commands,
      })
      dialog.close()
    },
  }))

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (saveMutation.isPending || !canSubmit()) return
    saveMutation.mutate()
  }

  return (
    <Dialog title={language.t("dialog.project.rename.title")} class="os-client-project-create w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} class="os-client-project-create-form flex flex-col gap-5 p-5 pt-4">
        <div class="flex flex-col gap-3">
          <TextField
            autofocus
            type="text"
            label={language.t("dialog.project.rename.name")}
            placeholder={folderName()}
            value={store.name}
            onChange={(v) => setStore("name", v)}
          />
          <p class="os-client-project-create-path text-12-regular text-text-weak">
            {language.t("dialog.project.rename.path", { path: pathHint() })}
          </p>
        </div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="large"
            disabled={saveMutation.isPending || !canSubmit()}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
