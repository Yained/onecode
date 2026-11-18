import { For, Show, createMemo } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getCapabilityResource } from "./catalog"

function runtimeMeta(resourceId: string) {
  const resource = getCapabilityResource(resourceId)
  const prompt = resource?.install.prompt ?? ""
  const links = [...prompt.matchAll(/https?:\/\/\S+/g)].map((match) => match[0])
  return {
    id: resourceId,
    name: resource?.name ?? resourceId,
    blurb: resource?.blurb ?? "缺少可识别的运行环境",
    links,
  }
}

export function ScenarioMissingRuntimeDialog(props: {
  reason?: string
  resourceIds: string[]
  onConfirm: (resourceIds: string[]) => void
}) {
  const dialog = useDialog()
  const items = createMemo(() => props.resourceIds.map(runtimeMeta).filter((item) => !!getCapabilityResource(item.id)))

  return (
    <Dialog title="缺少运行环境" size="large" fit>
      <div class="os-client-scenario-missing-dialog">
        <p class="os-client-scenario-missing-reason">
          {props.reason || "当前步骤缺少 VASP / LAMMPS 等运行环境。可先按下方安装配置（含下载链接）完成环境，再继续场景步骤。"}
        </p>
        <div class="os-client-scenario-runtime-list">
          <For each={items()}>
            {(item) => (
              <div class="os-client-scenario-runtime-card">
                <strong>{item.name}</strong>
                <p>{item.blurb}</p>
                <Show when={item.links.length > 0}>
                  <ul>
                    <For each={item.links}>
                      {(link) => (
                        <li>
                          <a href={link} target="_blank" rel="noreferrer">
                            {link}
                          </a>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <Show when={item.links.length === 0}>
                  <small>安装 Prompt 中未解析到直链，将发送完整环境配置说明。</small>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="os-client-scenario-missing-actions">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            稍后处理
          </Button>
          <Button
            variant="primary"
            size="large"
            disabled={items().length === 0}
            onClick={() => {
              props.onConfirm(items().map((item) => item.id))
              dialog.close()
            }}
          >
            安装并继续
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
