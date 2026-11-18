const ROOT_CLASS = "size-full flex flex-col"

interface NewSessionViewProps {
  worktree: string
}

export function NewSessionView(_props: NewSessionViewProps) {
  return (
    <div class={ROOT_CLASS}>
      <div class="h-12 shrink-0" aria-hidden />
      <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-28 flex justify-center">
        <div class="os-new-session-stage os-client-chat-hero w-full max-w-36rem my-auto py-8">
          <img class="os-client-logo" src="/assets/onescience/onescience-logo.png" alt="OneScience" />
          <h1>全流程科研模型生成平台</h1>
          <p>从需求、数据、模型、skills 到运行环境，把科研工作组织成可执行的客户端任务。</p>
        </div>
      </div>
    </div>
  )
}
