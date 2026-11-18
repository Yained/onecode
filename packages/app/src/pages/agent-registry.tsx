import { Component, createSignal, createEffect, For, Show } from "solid-js"

export default function AgentRegistry() {
  const [primitives, setPrimitives] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [domainFilter, setDomainFilter] = createSignal("")
  const [typeFilter, setTypeFilter] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal("callable")
  const [selectedPrimitive, setSelectedPrimitive] = createSignal<any>(null)

  const loadPrimitives = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (domainFilter()) params.set("domain", domainFilter())
      if (typeFilter()) params.set("primitiveType", typeFilter())
      if (statusFilter()) params.set("status", statusFilter())

      const response = await fetch(`/api/experimental/onescience/agent-registry?${params}`)
      if (!response.ok) throw new Error("加载失败")

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

  createEffect(() => {
    // 监听筛选条件变化
    domainFilter()
    typeFilter()
    statusFilter()
    loadPrimitives()
  })

  return (
    <div class="container mx-auto px-4 py-8">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">Agent Registry</h1>
        <p class="text-gray-600">代理注册表 - 可调用的 AI 原语</p>
      </div>

      {/* 搜索和筛选 */}
      <div class="mb-6 flex gap-4 flex-wrap">
        <input
          type="text"
          placeholder="搜索原语..."
          class="flex-1 min-w-[200px] border rounded px-4 py-2"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
        <select
          class="border rounded px-4 py-2"
          value={domainFilter()}
          onChange={(e) => setDomainFilter(e.currentTarget.value)}
        >
          <option value="">所有领域</option>
          <option value="地球科学">地球科学</option>
          <option value="生命科学">生命科学</option>
          <option value="材料化学">材料化学</option>
          <option value="流体仿真">流体仿真</option>
        </select>
        <select
          class="border rounded px-4 py-2"
          value={typeFilter()}
          onChange={(e) => setTypeFilter(e.currentTarget.value)}
        >
          <option value="">所有类型</option>
          <option value="model.run">模型运行</option>
          <option value="data.load">数据加载</option>
          <option value="data.transform">数据转换</option>
          <option value="model.train">模型训练</option>
          <option value="model.evaluate">模型评估</option>
        </select>
        <select
          class="border rounded px-4 py-2"
          value={statusFilter()}
          onChange={(e) => setStatusFilter(e.currentTarget.value)}
        >
          <option value="">所有状态</option>
          <option value="callable">可调用</option>
          <option value="verified">已验证</option>
        </select>
      </div>

      {/* 加载状态 */}
      <Show when={loading()}>
        <div class="text-center py-8">加载中...</div>
      </Show>

      {/* 原语列表 */}
      <Show when={!loading()}>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <For each={primitives()}>
            {(primitive) => (
              <div class="border rounded p-4 hover:shadow-lg transition-shadow">
                <h3 class="font-bold mb-2 text-lg">{primitive.title}</h3>
                <p class="text-sm text-gray-600 mb-3 line-clamp-2">{primitive.description}</p>
                <div class="flex gap-2 mb-3 flex-wrap">
                  <span class="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">{primitive.status}</span>
                  <span class="text-xs px-2 py-1 bg-gray-100 text-gray-800 rounded">{primitive.primitiveType}</span>
                  <span class="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">{primitive.domain}</span>
                </div>
                <div class="flex gap-2">
                  <button
                    class="text-sm text-blue-600 hover:underline"
                    onClick={() => setSelectedPrimitive(primitive)}
                  >
                    查看契约
                  </button>
                  <button class="text-sm text-blue-600 hover:underline">使用</button>
                </div>
              </div>
            )}
          </For>
        </div>
        <Show when={primitives().length === 0}>
          <div class="text-center py-8 text-gray-500">暂无可用原语</div>
        </Show>
      </Show>

      {/* 契约查看对话框 */}
      <Show when={selectedPrimitive()}>
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setSelectedPrimitive(null)}>
          <div
            class="rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-border-base bg-surface-raised-stronger-non-alpha text-text-strong shadow-[var(--shadow-lg-border-base)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="text-xl font-bold mb-4">原语契约</h2>

            <div class="space-y-4">
              <div>
                <h3 class="font-semibold mb-2">基本信息</h3>
                <div class="space-y-1 text-sm text-text-base">
                  <p><strong>名称:</strong> {selectedPrimitive()?.title}</p>
                  <p><strong>类型:</strong> {selectedPrimitive()?.primitiveType}</p>
                  <p><strong>领域:</strong> {selectedPrimitive()?.domain}</p>
                  <p><strong>状态:</strong> {selectedPrimitive()?.status}</p>
                </div>
              </div>

              <Show when={selectedPrimitive()?.contractJson}>
                <div>
                  <h3 class="font-semibold mb-2">契约定义</h3>
                  <pre class="rounded border border-border-weak-base bg-background-base p-4 overflow-x-auto text-xs text-text-base">
                    {JSON.stringify(selectedPrimitive()?.contractJson, null, 2)}
                  </pre>
                </div>
              </Show>

              <Show when={selectedPrimitive()?.adapterJson}>
                <div>
                  <h3 class="font-semibold mb-2">适配器配置</h3>
                  <pre class="rounded border border-border-weak-base bg-background-base p-4 overflow-x-auto text-xs text-text-base">
                    {JSON.stringify(selectedPrimitive()?.adapterJson, null, 2)}
                  </pre>
                </div>
              </Show>
            </div>

            <div class="flex justify-end mt-6">
              <button
                type="button"
                class="px-4 py-2 rounded border border-border-base bg-surface-raised-base text-text-strong hover:bg-surface-raised-base-hover"
                onClick={() => setSelectedPrimitive(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
