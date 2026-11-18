import { A, useLocation, useNavigate } from "@solidjs/router"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { docsItems } from "@/pages/onescience-docs"
import { workspaceDocsHref, workspaceHomeHref } from "@/workbench/routes"

const docSections = [
  { id: "manual" as const, label: "用户手册", hint: "平台与 OneSkills 使用说明", match: (tags: readonly string[]) => tags.includes("用户手册") },
  { id: "plugins" as const, label: "插件与镜像", hint: "插件协议与运行镜像", match: (tags: readonly string[]) => tags.includes("插件") || tags.includes("镜像") },
  { id: "release" as const, label: "发版记录", hint: "版本变化与重要调整", match: (tags: readonly string[]) => tags.includes("发版记录") || tags.includes("版本记录") },
]

function sectionFromHash(hash: string) {
  const raw = hash.replace(/^#/, "").trim().toLowerCase()
  if (raw === "manual" || raw === "plugins" || raw === "release") return raw
  return "manual" as const
}

export function WorkbenchDocsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [section, setSection] = createSignal(sectionFromHash(location.hash))

  createEffect(() => setSection(sectionFromHash(location.hash)))

  const selectSection = (id: (typeof docSections)[number]["id"]) => {
    setSection(id)
    navigate(workspaceDocsHref(id), { replace: true })
  }

  const active = () => docSections.find((item) => item.id === section()) ?? docSections[0]
  const items = createMemo(() => docsItems.filter((item) => active().match(item.tags)))

  return (
    <div class="os-client-capability-page os-client-docs-page">
      <header class="os-client-docs-head">
        <div class="os-client-docs-head-copy">
          <h2>帮助</h2>
          <p>平台使用说明、插件镜像与版本记录</p>
        </div>
        <A href={workspaceHomeHref()} class="os-client-docs-close" aria-label="关闭帮助">
          ×
        </A>
      </header>

      <section class="os-client-capability-selector" aria-label="帮助与文档">
        <div class="os-client-capability-current-domain">
          <span>文档分类：</span>
          <strong>{active().label}</strong>
          <small>点击条目在新窗口打开原文</small>
        </div>
        <div class="os-client-capability-tabs os-client-docs-tabs" role="tablist" aria-label="文档分类">
          <For each={docSections}>
            {(item) => (
              <button
                type="button"
                classList={{ "is-active": section() === item.id }}
                aria-pressed={section() === item.id}
                onClick={() => selectSection(item.id)}
              >
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </button>
            )}
          </For>
        </div>
      </section>

      <div class="os-client-capability-page-body">
        <section class="os-client-capability-resource-panel">
          <Show
            when={items().length > 0}
            fallback={<p class="os-client-capability-empty">该分类下暂无文档。</p>}
          >
            <div class="os-client-capability-page-grid">
              <For each={items()}>
                {(item) => (
                  <article class="os-client-capability-card">
                    <div>
                      <h4>{item.title}</h4>
                      <p>{item.copy}</p>
                    </div>
                    <div class="os-client-capability-meta">
                      <For each={item.tags}>{(tag) => <span>{tag}</span>}</For>
                    </div>
                    <div class="os-client-capability-actions">
                      <a href={item.href} target="_blank" rel="noreferrer" data-primary="true">
                        {item.action}
                      </a>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </div>
  )
}
