import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useServer } from "@/context/server"
import { useSessionKey } from "@/pages/session/session-layout"
import { peekPendingHandoffRawIds, queueHandoffRawIds, takePendingHandoffRawIds } from "@/pages/session/handoff"
import { storedPlatformAuthSession } from "@/utils/platform-auth"
import {
  getSessionChips,
  listRawSources,
  putSessionChips,
  catalogErrorMessage,
  isCatalogNotFoundError,
  type CatalogRaw,
} from "@/workbench/capabilities/onedata-catalog-api"
import { PromptComposerCard } from "@/components/prompt-input/composer-card"
import {
  resolveSessionRawChipItems,
  SESSION_RAW_CHIPS_CHANGED,
  type SessionRawChipItem,
} from "./resolve-session-raw-chips"

export function SessionRawDataChips() {
  const server = useServer()
  const route = useSessionKey()
  const [items, setItems] = createSignal<SessionRawChipItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  const sessionId = createMemo(() => route.params.id)
  const loggedIn = () => !!storedPlatformAuthSession()
  const serverUrl = () => server.current?.http.url
  const visible = createMemo(() => loggedIn() && (items().length > 0 || !!error()))

  const reload = async () => {
    const url = serverUrl()
    const id = sessionId()
    if (!url || !id || !loggedIn()) {
      setItems([])
      return
    }
    try {
      const [chips, raw] = await Promise.all([
        getSessionChips(url, id),
        listRawSources(url).catch(() => ({ items: [] as CatalogRaw[] })),
      ])
      setItems(resolveSessionRawChipItems(chips.raw_ids, raw.items))
      setError("")
    } catch (err) {
      if (isCatalogNotFoundError(err)) {
        setItems([])
        setError("")
        return
      }
      setError(catalogErrorMessage(err, "无法加载原始数据绑定"))
    }
  }

  createEffect(() => {
    const url = serverUrl()
    const id = sessionId()
    const dir = route.params.dir
    if (!url || !id || !dir || !loggedIn()) return
    if (!peekPendingHandoffRawIds(dir)?.length) return
    const pending = takePendingHandoffRawIds(dir)
    if (!pending?.length) return
    void (async () => {
      try {
        const current = await getSessionChips(url, id)
        const merged = Array.from(new Set([...current.raw_ids, ...pending]))
        await putSessionChips(url, id, merged)
        window.dispatchEvent(new Event(SESSION_RAW_CHIPS_CHANGED))
        await reload()
      } catch (err) {
        queueHandoffRawIds(dir, pending)
        setError(catalogErrorMessage(err, "无法绑定预填的原始数据"))
      }
    })()
  })

  createEffect(() => {
    sessionId()
    void reload()
  })

  createEffect(() => {
    const onChanged = () => void reload()
    window.addEventListener(SESSION_RAW_CHIPS_CHANGED, onChanged)
    onCleanup(() => window.removeEventListener(SESSION_RAW_CHIPS_CHANGED, onChanged))
  })

  const remove = async (rawId: string) => {
    const url = serverUrl()
    const id = sessionId()
    if (!url || !id) return
    setBusy(true)
    try {
      const next = items()
        .map((item) => item.id)
        .filter((value) => value !== rawId)
      await putSessionChips(url, id, next)
      window.dispatchEvent(new Event(SESSION_RAW_CHIPS_CHANGED))
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={visible()}>
      <div class="contents" data-testid="session-raw-chips">
        <Show when={error()}>
          <p class="basis-full px-0 text-12-regular text-text-danger-base">{error()}</p>
        </Show>
        <For each={items()}>
          {(item) => (
            <PromptComposerCard
              title={item.title}
              detail={item.uri || item.title}
              busy={busy()}
              preview={<Icon name="folder" class="size-5 text-icon-weak" />}
              badge={
                <span class="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[3px] px-0.5 text-[8px] font-semibold leading-none text-text-weak">
                  数据
                </span>
              }
              onRemove={() => void remove(item.id)}
              removeLabel={`移除 ${item.title}`}
            />
          )}
        </For>
      </div>
    </Show>
  )
}
