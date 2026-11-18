import { For, Show, createEffect, createSignal } from "solid-js"
import { useServer } from "@/context/server"
import { storedPlatformAuthSession } from "@/utils/platform-auth"
import { listAlreadyDatasets, type CatalogAlready } from "@/workbench/capabilities/onedata-catalog-api"

function parseRefs(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function toggleRef(current: string, id: string) {
  const set = new Set(parseRefs(current))
  if (set.has(id)) set.delete(id)
  else set.add(id)
  return Array.from(set).join(",")
}

export function AlreadyDatasetRefsField(props: {
  value: string
  onChange: (value: string) => void
  hint?: string
}) {
  const server = useServer()
  const [items, setItems] = createSignal<CatalogAlready[]>([])
  const [error, setError] = createSignal("")
  const selected = () => new Set(parseRefs(props.value))

  createEffect(() => {
    const url = server.current?.http.url
    if (!url || !storedPlatformAuthSession()) {
      setItems([])
      return
    }
    void Promise.all([
      listAlreadyDatasets(url, { scope: "mine" }),
      listAlreadyDatasets(url, { scope: "public" }),
    ])
      .then(([mine, pub]) => {
        const map = new Map<string, CatalogAlready>()
        for (const item of [...mine.items, ...pub.items]) {
          if (item.status !== "ready") continue
          map.set(item.id, item)
        }
        setItems(Array.from(map.values()))
        setError("")
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "无法加载可训练数据")
      })
  })

  return (
    <div class="os-already-refs-field" data-testid="already-dataset-refs-field">
      <Show when={error()}>
        <span class="os-field-help">{error()}</span>
      </Show>
      <Show when={items().length === 0 && !error()}>
        <span class="os-field-help">暂无就绪的可训练数据。请先在 OneData 转化或发布，或手动填写 alr_ 编号。</span>
      </Show>
      <Show when={items().length > 0}>
        <ul class="os-already-refs-list">
          <For each={items()}>
            {(item) => (
              <li>
                <label>
                  <input
                    type="checkbox"
                    checked={selected().has(item.id)}
                    onChange={() => props.onChange(toggleRef(props.value, item.id))}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.visibility === "public" ? "已公开 OneData" : "我的可训练数据"} · {item.id}
                    </small>
                  </span>
                </label>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <input
        value={props.value}
        onInput={(event) => props.onChange(event.currentTarget.value)}
        placeholder="也可手动填写 alr_…（多个用逗号分隔）"
      />
      <Show when={props.hint}>
        <span class="os-field-help">{props.hint}</span>
      </Show>
    </div>
  )
}
