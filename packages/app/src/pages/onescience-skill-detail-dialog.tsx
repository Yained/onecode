import { Markdown } from "@opencode-ai/ui/markdown"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { fetchCatalogSkillBody } from "./onescience-catalog"
import {
  formatSkillFrontmatterScalar,
  skillFrontmatterEntries,
  skillFrontmatterHasContent,
  skillFrontmatterLabel,
  skillFrontmatterListItems,
  skillFrontmatterNested,
} from "./skill-markdown-display"

export type SkillDetailItem = {
  id: string
  title: string
  copy: string
  layer?: string
  tags?: readonly string[]
  provider?: string
}

function SkillFrontmatterPanel(props: { data: Record<string, unknown>; workbench?: boolean }) {
  const entries = () => skillFrontmatterEntries(props.data)
  return (
    <section class="os-skill-detail-meta" classList={{ "is-workbench": props.workbench }}>
      <div class="os-skill-detail-section-label">技能元数据</div>
      <dl class="os-skill-detail-meta-grid">
        <For each={entries()}>
          {([key, value]) => (
            <>
              <dt>{skillFrontmatterLabel(key)}</dt>
              <dd>
                <Show when={skillFrontmatterListItems(value).length > 0}>
                  <div class="os-tag-row os-skill-detail-meta-tags">
                    <For each={skillFrontmatterListItems(value)}>{(item) => <span class="os-tag">{item}</span>}</For>
                  </div>
                </Show>
                <Show when={skillFrontmatterListItems(value).length === 0 && skillFrontmatterNested(value)}>
                  {(nested) => <pre class="os-skill-detail-meta-nested">{nested()}</pre>}
                </Show>
                <Show when={skillFrontmatterListItems(value).length === 0 && !skillFrontmatterNested(value)}>
                  <span class="os-skill-detail-meta-value">{formatSkillFrontmatterScalar(value)}</span>
                </Show>
              </dd>
            </>
          )}
        </For>
      </dl>
    </section>
  )
}

export function SkillDetailDialog(props: {
  item?: SkillDetailItem
  open: boolean
  serverUrl?: string
  variant?: "default" | "workbench"
  onClose: () => void
  onDevelop: () => void
}) {
  const [loading, setLoading] = createSignal(false)
  const [content, setContent] = createSignal<string>()
  const [frontmatter, setFrontmatter] = createSignal<Record<string, unknown>>()
  const [location, setLocation] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const workbench = () => props.variant === "workbench"
  const activeItem = createMemo(() => (props.open ? props.item : undefined))

  createEffect(() => {
    const item = activeItem()
    const serverUrl = props.serverUrl
    if (!item || !serverUrl) {
      setLoading(false)
      setContent(undefined)
      setFrontmatter(undefined)
      setLocation(undefined)
      setError(undefined)
      return
    }

    let active = true
    setLoading(true)
    setContent(undefined)
    setFrontmatter(undefined)
    setLocation(undefined)
    setError(undefined)

    void fetchCatalogSkillBody(serverUrl, item.id).then((result) => {
      if (!active) return
      setLoading(false)
      if (!result.loaded) {
        setError(result.error ?? "无法加载技能内容")
        return
      }
      setLocation(result.location)
      if (result.content) {
        setContent(result.content)
        setFrontmatter(result.frontmatter)
        return
      }
      setError(result.error ?? "技能文件不可用")
    })

    onCleanup(() => {
      active = false
    })
  })

  const headerChips = () => {
    const item = activeItem()
    if (!item) return [] as { label: string; tone?: string }[]
    const chips: { label: string; tone?: string }[] = []
    if (item.layer) chips.push({ label: item.layer, tone: "layer" })
    if (item.provider) chips.push({ label: item.provider, tone: "provider" })
    for (const tag of (item.tags ?? []).slice(0, 4)) {
      if (tag === item.layer || tag === item.provider) continue
      chips.push({ label: tag })
    }
    return chips
  }

  return (
    <Show when={activeItem()}>
      <Portal mount={typeof document === "undefined" ? undefined : document.body}>
        <div
          classList={{
            "os-modal-backdrop": !workbench(),
            "os-client-capability-skill-detail-overlay": workbench(),
          }}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) props.onClose()
          }}
        >
          <div
            classList={{
              "os-upload-dialog os-skill-detail-dialog": !workbench(),
              "os-client-capability-skill-detail-dialog": workbench(),
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`技能详情 ${activeItem()!.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              classList={{
                "os-skill-detail-head": !workbench(),
                "os-client-capability-skill-detail-head": workbench(),
              }}
            >
              <div class="os-skill-detail-head-main">
                <div classList={{ "os-eyebrow": !workbench(), "os-client-capability-skill-detail-eyebrow": workbench() }}>
                  OneSkills
                </div>
                <h2>{activeItem()!.title}</h2>
                <p class="os-skill-detail-summary">{activeItem()!.copy}</p>
                <Show when={headerChips().length > 0}>
                  <div class="os-skill-detail-chips">
                    <For each={headerChips()}>
                      {(chip) => (
                        <span class="os-skill-detail-chip" data-tone={chip.tone}>{chip.label}</span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <button
                type="button"
                classList={{
                  "os-button os-button-secondary os-button-square": !workbench(),
                  "os-client-capability-skill-detail-close": workbench(),
                }}
                onClick={props.onClose}
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div class="os-skill-detail-body" classList={{ "is-workbench": workbench() }} aria-busy={loading()}>
              <Show when={loading()}>
                <div class="os-skill-detail-loading">
                  <div class="os-skill-detail-loading-bar" />
                  <div class="os-skill-detail-loading-bar os-skill-detail-loading-bar-short" />
                  <div class="os-skill-detail-loading-bar" />
                  <p>正在加载 SKILL.md...</p>
                </div>
              </Show>
              <Show when={!loading() && error()}>
                {(message) => (
                  <div classList={{ "os-upload-error": !workbench(), "os-client-capability-skill-detail-error": workbench() }}>
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={!loading() && !error()}>
                <Show when={skillFrontmatterHasContent(frontmatter())}>
                  <SkillFrontmatterPanel data={frontmatter()!} workbench={workbench()} />
                </Show>
                <section class="os-skill-detail-content">
                  <div class="os-skill-detail-section-label">技能说明</div>
                  <Show when={content()} fallback={<p class="os-section-copy">该技能暂无正文内容。</p>}>
                    {(text) => (
                      <div class="os-skill-detail-markdown">
                        <Markdown text={text()} cacheKey={`skill-detail:${activeItem()!.id}`} />
                      </div>
                    )}
                  </Show>
                </section>
              </Show>
            </div>

            <div
              classList={{
                "os-skill-detail-footer": !workbench(),
                "os-client-capability-skill-detail-footer": workbench(),
              }}
            >
              <Show when={location()} fallback={<span class="os-skill-detail-path-empty">路径待加载</span>}>
                {(path) => (
                  <code class="os-skill-detail-path" title={path()}>
                    <span class="os-skill-detail-path-label">路径</span>
                    <span class="os-skill-detail-path-value">{path()}</span>
                  </code>
                )}
              </Show>
              <div classList={{ "os-upload-actions": !workbench(), "os-client-capability-skill-detail-actions": workbench() }}>
                <button
                  type="button"
                  classList={{
                    "os-button os-button-secondary": !workbench(),
                    "os-client-capability-skill-detail-action": workbench(),
                  }}
                  onClick={props.onClose}
                >
                  关闭
                </button>
                <button
                  type="button"
                  classList={{
                    "os-button os-button-primary": !workbench(),
                    "os-client-capability-skill-detail-action is-primary": workbench(),
                  }}
                  onClick={props.onDevelop}
                >
                  开发
                </button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
