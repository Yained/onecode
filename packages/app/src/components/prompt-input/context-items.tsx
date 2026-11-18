import { Component, For, Match, Show, Switch } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getDirectory, getFilename, getFilenameTruncated } from "@opencode-ai/core/util/path"
import type { ContextItem, FileContextItem, SkillContextItem } from "@/context/prompt"

type PromptContextItem = ContextItem & { key: string }
type FilePromptContextItem = FileContextItem & { key: string }
type SkillPromptContextItem = SkillContextItem & { key: string }

type ContextItemsProps = {
  items: PromptContextItem[]
  active: (item: FilePromptContextItem) => boolean
  openComment: (item: FilePromptContextItem) => void
  remove: (item: PromptContextItem) => void
  t: (key: string) => string
}

export const PromptContextItems: Component<ContextItemsProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      <div class="flex flex-nowrap items-start gap-2 p-2 overflow-x-auto no-scrollbar">
        <For each={props.items}>
          {(item) => (
            <Switch>
              <Match when={item.type === "skill" ? (item as SkillPromptContextItem) : undefined}>
                {(skill) => (
                  <Tooltip value={skill().name} placement="top" openDelay={2000}>
                    <div class="group shrink-0 flex items-center gap-1.5 rounded-[6px] pl-2 pr-1 py-1 max-w-[220px] h-8 bg-background-stronger shadow-xs-border hover:shadow-xs-border-hover">
                      <Icon name="brain" size="small" class="shrink-0 text-icon-info-active" />
                      <span class="text-11-regular text-text-strong whitespace-nowrap truncate min-w-0">
                        {skill().title || skill().name}
                      </span>
                      <IconButton
                        type="button"
                        icon="close-small"
                        variant="ghost"
                        class="ml-auto size-3.5 text-text-weak hover:text-text-strong transition-all"
                        onClick={(e) => {
                          e.stopPropagation()
                          props.remove(skill())
                        }}
                        aria-label={props.t("prompt.context.removeSkill")}
                      />
                    </div>
                  </Tooltip>
                )}
              </Match>
              <Match when={item.type === "file" ? (item as FilePromptContextItem) : undefined}>
                {(file) => {
                  const directory = getDirectory(file().path)
                  const filename = getFilename(file().path)
                  const label = getFilenameTruncated(file().path, 14)
                  const selected = props.active(file())

                  return (
                    <Tooltip
                      value={
                        <span class="flex max-w-[300px]">
                          <span class="text-text-invert-base truncate-start [unicode-bidi:plaintext] min-w-0">
                            {directory}
                          </span>
                          <span class="shrink-0">{filename}</span>
                        </span>
                      }
                      placement="top"
                      openDelay={2000}
                    >
                      <div
                        classList={{
                          "group shrink-0 flex flex-col rounded-[6px] pl-2 pr-1 py-1 max-w-[200px] h-12 cursor-default transition-all transition-transform shadow-xs-border hover:shadow-xs-border-hover": true,
                          "hover:bg-surface-interactive-weak": !!file().commentID && !selected,
                          "bg-surface-interactive-hover hover:bg-surface-interactive-hover shadow-xs-border-hover": selected,
                          "bg-background-stronger": !selected,
                        }}
                        onClick={() => props.openComment(file())}
                      >
                        <div class="flex items-center gap-1.5">
                          <FileIcon node={{ path: file().path, type: "file" }} class="shrink-0 size-3.5" />
                          <div class="flex items-center text-11-regular min-w-0 font-medium">
                            <span class="text-text-strong whitespace-nowrap">{label}</span>
                            <Show when={file().selection}>
                              {(sel) => (
                                <span class="text-text-weak whitespace-nowrap shrink-0">
                                  {sel().startLine === sel().endLine
                                    ? `:${sel().startLine}`
                                    : `:${sel().startLine}-${sel().endLine}`}
                                </span>
                              )}
                            </Show>
                          </div>
                          <IconButton
                            type="button"
                            icon="close-small"
                            variant="ghost"
                            class="ml-auto size-3.5 text-text-weak hover:text-text-strong transition-all"
                            onClick={(e) => {
                              e.stopPropagation()
                              props.remove(file())
                            }}
                            aria-label={props.t("prompt.context.removeFile")}
                          />
                        </div>
                        <Show when={file().comment}>
                          {(comment) => <div class="text-12-regular text-text-strong ml-5 pr-1 truncate">{comment()}</div>}
                        </Show>
                      </div>
                    </Tooltip>
                  )
                }}
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </Show>
  )
}
