import { For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import type { TaskProfileItem } from "@/pages/onescience"

const categoryLabels: Record<string, string> = {
  build: "构建",
  run: "运行",
  optimize: "优化",
  reproduce: "复现",
  release: "发布",
}

const categoryOrder = ["build", "run", "optimize", "reproduce", "release"] as const

const categoryMeta: Record<string, { icon: "code" | "console" | "sliders" | "refresh" | "task"; tone: string }> = {
  build: { icon: "code", tone: "build" },
  run: { icon: "console", tone: "run" },
  optimize: { icon: "sliders", tone: "optimize" },
  reproduce: { icon: "refresh", tone: "reproduce" },
  release: { icon: "task", tone: "release" },
}

function groupProfiles(profiles: readonly TaskProfileItem[]) {
  const byCategory = profiles.reduce((map, item) => {
    const list = map.get(item.category) ?? []
    list.push(item)
    map.set(item.category, list)
    return map
  }, new Map<string, TaskProfileItem[]>())

  const ordered = categoryOrder.flatMap((category) => {
    const items = byCategory.get(category)
    if (!items?.length) return []
    byCategory.delete(category)
    return [{
      category,
      label: categoryLabels[category],
      icon: categoryMeta[category].icon,
      tone: categoryMeta[category].tone,
      items,
    }]
  })

  return [
    ...ordered,
    ...[...byCategory.entries()].map(([category, items]) => ({
      category,
      label: categoryLabels[category] ?? category,
      icon: categoryMeta[category]?.icon ?? ("task" as const),
      tone: categoryMeta[category]?.tone ?? "release",
      items,
    })),
  ]
}

export function SkillTaskProfileBoxes(props: {
  profiles: readonly TaskProfileItem[]
  onStart?: (profile: TaskProfileItem) => void
}) {
  return (
    <div class="os-skill-task-groups" data-layout="chatgpt-boxes">
      <For each={groupProfiles(props.profiles)}>
        {(group) => (
          <section class={`os-skill-task-group os-skill-task-group-${group.tone}`}>
            <div class="os-skill-task-group-icon" aria-hidden="true">
              <Icon name={group.icon} size="small" />
            </div>
            <h3 class="os-skill-task-group-label">{group.label}</h3>
            <div class="os-skill-task-chips">
              <For each={group.items}>
                {(item) => (
                  <button type="button" class="os-skill-task-chip" onClick={() => props.onStart?.(item)}>
                    {item.title}
                  </button>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  )
}

export function SkillTaskProfileBoxesSkeleton() {
  return (
    <div class="os-skill-task-groups" data-layout="chatgpt-boxes" aria-busy="true">
      <For each={Array.from({ length: 4 })}>
        {() => (
          <div class="os-skill-task-group">
            <div class="os-skill-task-group-icon os-skill-task-skeleton-label os-skeleton-line" />
            <div class="os-skill-task-group-label os-skill-task-skeleton-label os-skeleton-line" />
            <div class="os-skill-task-chips">
              <For each={Array.from({ length: 3 })}>
                {() => <div class="os-skill-task-chip os-skill-task-skeleton-chip os-skeleton-line" />}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

export function SkillTaskProfileBoxesFallback(props: { loaded: boolean }) {
  return (
    <Show
      when={props.loaded}
      fallback={<SkillTaskProfileBoxesSkeleton />}
    >
      <p class="text-12-medium text-text-weak">暂时无法加载科研能力入口，请稍后重试。</p>
    </Show>
  )
}
