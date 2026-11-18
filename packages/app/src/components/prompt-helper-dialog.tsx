import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createSignal, For, Show } from "solid-js"
import { useServer } from "@/context/server"
import { TaskCreateDialog } from "@/components/onescience/TaskCreateDialog"
import { listOneScienceTaskProfiles, SkillTaskProfileGrid, type TaskProfileItem } from "@/pages/onescience"

export function PromptHelperDialog(props: { onStart: (prompt: string) => void }) {
  const dialog = useDialog()
  const server = useServer()
  const [profiles, setProfiles] = createSignal<readonly TaskProfileItem[]>([])
  const [selectedProfile, setSelectedProfile] = createSignal<TaskProfileItem>()

  createEffect(() => {
    const current = server.current
    if (!current) return
    void listOneScienceTaskProfiles(current.http.url).then((result) => setProfiles(result.items))
  })

  return (
    <div class="os-modal-backdrop" role="presentation" onClick={() => dialog.close()}>
      <section
        class="os-upload-dialog os-prompt-helper-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="科研提示词助手"
        onClick={(event) => event.stopPropagation()}
      >
        <div class="os-upload-head">
          <div>
            <div class="os-eyebrow">OneScience</div>
            <h2>科研提示词助手</h2>
            <p>选择一个科研任务类型，按目标、数据、模型和原语生成可直接发送的结构化提示词。</p>
          </div>
          <Button variant="ghost" size="normal" onClick={() => dialog.close()}>×</Button>
        </div>
        <div class="os-prompt-helper-layout">
          <aside class="os-prompt-helper-panel">
            <strong>从科研任务开始</strong>
            <p>选择模板后继续填写目标、资源、约束和输出要求，助手会生成适合直接发送给 AI 的完整科研提示词。</p>
            <ul>
              <li>结构化任务目标</li>
              <li>补全数据与模型上下文</li>
              <li>生成可执行工作流提示</li>
            </ul>
          </aside>
          <div class="os-prompt-helper-content">
            <Show
              when={profiles().length > 0}
              fallback={
                <div class="os-skill-task-grid" aria-busy="true">
                  <For each={Array.from({ length: 6 })}>{() => <div class="os-skill-task-card os-resource-skeleton" />}</For>
                </div>
              }
            >
              <SkillTaskProfileGrid profiles={profiles()} onStart={setSelectedProfile} />
            </Show>
          </div>
        </div>
      </section>
      <TaskCreateDialog
        open={!!selectedProfile()}
        serverUrl={server.current?.http.url}
        profile={selectedProfile()}
        onClose={() => setSelectedProfile(undefined)}
        onStart={(prompt) => {
          props.onStart(prompt)
          dialog.close()
        }}
      />
    </div>
  )
}
