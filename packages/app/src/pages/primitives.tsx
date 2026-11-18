import { Component, createSignal, createEffect, For, Show } from "solid-js"
import { primitivePage } from "./onescience-primitives"

export default function Primitives() {
  const [primitives, setPrimitives] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)
  const [filter, setFilter] = createSignal("全部")

  const loadPrimitives = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/experimental/onescience/primitive")
      if (!response.ok) throw new Error("API 失败")

      const data = await response.json()
      setPrimitives(data.items || [])
    } catch (err) {
      console.error("加载原语失败:", err)
      setPrimitives([])
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    loadPrimitives()
  })

  const filteredPrimitives = () => {
    if (filter() === "全部") return primitives()
    return primitives().filter((p: any) => {
      const tags = p.tags || p.intentTags || []
      return tags.includes(filter())
    })
  }

  return (
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-2xl font-bold">{primitivePage.title}</h1>
        <p class="text-text-weak mt-1">{primitivePage.count}</p>
      </div>

      <div class="mb-4 flex gap-2 flex-wrap">
        <For each={primitivePage.filters}>
          {(item) => (
            <button
              class={`px-3 py-1 rounded border ${filter() === item ? "bg-background-strong" : ""}`}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          )}
        </For>
      </div>

      <Show when={!loading()} fallback={<div>加载中...</div>}>
        <div class="mb-2 text-sm text-text-weak">共 {primitives().length} 个原语</div>
        <div class="grid gap-3">
          <For each={filteredPrimitives()}>
            {(item) => (
              <div class="border rounded p-4">
                <div class="font-medium">{item.title || item.name}</div>
                <div class="text-sm text-text-weak mt-1">{item.description || item.copy}</div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
