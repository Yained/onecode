import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { createMemo, createSignal, Show } from "solid-js"
import { RuntimeEnvironmentSelect } from "@/components/onescience/RuntimeEnvironmentSelect"
import {
  runtimeEnvironmentFor,
  runtimeEnvironmentLabel,
  setRuntimeEnvironmentFor,
  type RuntimeEnvironment,
} from "@/components/onescience/runtime-environment"
import { remoteWorkspaceFor, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import { useLanguage } from "@/context/language"

function disconnectTargetFor(directory: string, next: RuntimeEnvironment) {
  remoteWorkspaceRevision()
  const current = remoteWorkspaceFor(directory)
  if (!current) return undefined
  if (next.kind === "ssh" && next.targetName === current.targetName) return undefined
  return current.targetName
}

export function DialogProjectEnvironment(props: { directory: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [env, setEnv] = createSignal<RuntimeEnvironment>(runtimeEnvironmentFor(props.directory))
  const disconnectTarget = createMemo(() => disconnectTargetFor(props.directory, env()))

  const save = () => {
    setRuntimeEnvironmentFor(props.directory, env())
    dialog.close()
  }

  return (
    <Dialog title={language.t("dialog.project.environment.title")} class="os-session-align-dialog w-full">
      <div class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex flex-col gap-3">
          <RuntimeEnvironmentSelect
            directory={() => props.directory}
            value={env}
            onChange={setEnv}
            variant="field"
            hideScnet
          />
          <p class="text-12-regular text-text-weak">{language.t("dialog.project.environment.hint")}</p>
          <Show when={disconnectTarget()}>
            {(target) => (
              <p class="text-12-regular text-text-weak">
                {language.t("dialog.project.environment.disconnectWarning", { target: target() })}
              </p>
            )}
          </Show>
        </div>
        <div class="flex justify-end">
          <Button type="button" variant="primary" size="large" onClick={save}>
            {language.t("common.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogAlignProjectEnvironment(props: {
  directory: string
  env: RuntimeEnvironment
  disconnectTarget?: string
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const save = () => {
    setRuntimeEnvironmentFor(props.directory, props.env)
    dialog.close()
  }

  return (
    <Dialog title={language.t("session.environment.align.title")} class="os-session-align-dialog w-full">
      <div class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex flex-col gap-3">
          <p class="text-14-regular text-text-strong">
            {language.t("session.environment.align.body", { env: runtimeEnvironmentLabel(props.env) })}
          </p>
          <Show when={props.disconnectTarget}>
            {(target) => (
              <p class="text-12-regular text-text-weak">
                {language.t("session.environment.align.disconnect", { target: target() })}
              </p>
            )}
          </Show>
        </div>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" size="large" onClick={save}>
            {language.t("session.environment.align.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
