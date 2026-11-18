import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { LocalProject } from "@/context/layout"
import { displayName } from "@/pages/layout/helpers"
import { isDefaultPlatformProject, storedPlatformAuthSession } from "@/utils/platform-auth"
import { pathKey } from "@/utils/path-key"

const MENU_CONTENT_CLASS = "os-client-session-menu"
const SUB_CONTENT_CLASS = "os-client-session-menu os-client-session-menu-sub"

export function SessionMoveSubmenu(props: {
  currentDirectory: string
  projects: () => LocalProject[]
  onMove: (targetDirectory: string) => void
  onNewProject: () => void
}) {
  const language = useLanguage()
  const session = () => storedPlatformAuthSession()
  // Promote is only allowed from the default staging project.
  const canPromote = () => isDefaultPlatformProject(session(), props.currentDirectory)
  const targets = () =>
    props
      .projects()
      .filter((project) => pathKey(project.worktree) !== pathKey(props.currentDirectory))
      .filter((project) => !isDefaultPlatformProject(session(), project.worktree))

  return (
    <Show when={canPromote()}>
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger data-action="session-move" class="os-client-session-menu-item">
          <Icon name="folder" size="small" class="os-client-session-menu-icon" />
          <span class="os-client-session-menu-label">{language.t("session.move.toProject")}</span>
          <Icon name="chevron-right" size="small" class="os-client-session-menu-chevron" />
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent class={SUB_CONTENT_CLASS}>
            <DropdownMenu.Item
              data-action="session-move-new-project"
              class="os-client-session-menu-item"
              onSelect={() => props.onNewProject()}
            >
              <Icon name="plus" size="small" class="os-client-session-menu-icon" />
              <DropdownMenu.ItemLabel class="os-client-session-menu-label">
                {language.t("session.move.newProject")}
              </DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Separator class="os-client-session-menu-separator" />
            <Show
              when={targets().length > 0}
              fallback={
                <div class="os-client-session-menu-empty">{language.t("session.move.emptyProjects")}</div>
              }
            >
              <For each={targets()}>
                {(project) => (
                  <DropdownMenu.Item
                    data-action="session-move-target"
                    class="os-client-session-menu-item"
                    onSelect={() => props.onMove(project.worktree)}
                  >
                    <Icon name="folder" size="small" class="os-client-session-menu-icon" />
                    <DropdownMenu.ItemLabel class="os-client-session-menu-label">
                      {displayName(project)}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                )}
              </For>
            </Show>
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
    </Show>
  )
}

export function SessionContextMenuContent(props: {
  currentDirectory: string
  projects: () => LocalProject[]
  onArchive: () => void
  onDelete: () => void
  onMove: (targetDirectory: string) => void
  onNewProject: () => void
}) {
  const language = useLanguage()

  return (
    <>
      <DropdownMenu.Item
        data-action="session-archive"
        class="os-client-session-menu-item"
        onSelect={() => props.onArchive()}
      >
        <Icon name="archive" size="small" class="os-client-session-menu-icon" />
        <DropdownMenu.ItemLabel class="os-client-session-menu-label">
          {language.t("common.archive")}
        </DropdownMenu.ItemLabel>
      </DropdownMenu.Item>
      <SessionMoveSubmenu
        currentDirectory={props.currentDirectory}
        projects={props.projects}
        onMove={props.onMove}
        onNewProject={props.onNewProject}
      />
      <DropdownMenu.Separator class="os-client-session-menu-separator" />
      <DropdownMenu.Item
        data-action="session-delete"
        class="os-client-session-menu-item is-danger"
        onSelect={() => props.onDelete()}
      >
        <Icon name="trash" size="small" class="os-client-session-menu-icon" />
        <DropdownMenu.ItemLabel class="os-client-session-menu-label">
          {language.t("common.delete")}
        </DropdownMenu.ItemLabel>
      </DropdownMenu.Item>
    </>
  )
}

export { MENU_CONTENT_CLASS }
