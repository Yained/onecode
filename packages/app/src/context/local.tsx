import { storedPlatformAuthSession } from "@/utils/platform-auth"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useRouteParams } from "@/hooks/use-route-params"
import { batch, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useModels } from "@/context/models"
import { useProviders } from "@/hooks/use-providers"
import { Persist, persisted } from "@/utils/persist"
import { defaultFreeModelCandidates, isWeakerAutomaticDefault } from "./free-model"
import { migrateModelSelection, modelSelectionPersistKey } from "./local-model-selection"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./model-variant"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import {
  ONESCIENCE_GLM_MODEL_ID,
  ONESCIENCE_GPT_MODEL_ID,
  ONESCIENCE_PROVIDER_ID,
  onescienceModelDisplayName,
  onescienceProviderDisplayName,
} from "@opencode-ai/ui/onescience-model-label"

export type ModelKey = { providerID: string; modelID: string; variant?: string }

type State = {
  agent?: string
  model?: ModelKey
  variant?: string | null
  modelPicked?: boolean
}

type Saved = {
  session: Record<string, State | undefined>
}

const handoff = new Map<string, State>()

const handoffKey = (dir: string, id: string) => `${dir}\n${id}`

const clone = (value: State | undefined) => {
  if (!value) return
  return {
    ...value,
    model: value.model ? { ...value.model } : undefined,
  } satisfies State
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const params = useRouteParams()
    const sdk = useSDK()
    const sync = useSync()
    const providers = useProviders()
    const models = useModels()

    const id = createMemo(() => params.id || undefined)
    const list = createMemo(() => sync.data.agent.filter((item) => item.mode !== "subagent" && !item.hidden))
    const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))

    const [saved, setSaved] = persisted(
      {
        ...Persist.workspace(sdk.directory, "model-selection", ["model-selection.v1"]),
        migrate: migrateModelSelection,
      },
      createStore<Saved>({
        session: {},
      }),
    )

    const [store, setStore] = createStore<{
      current?: string
      draft?: State
      last?: {
        type: "agent" | "model" | "variant"
        agent?: string
        model?: ModelKey | null
        variant?: string | null
      }
    }>({
      current: list()[0]?.name,
      draft: undefined,
      last: undefined,
    })

    const validModel = (model: ModelKey) => {
      const provider = providers.all().find((item) => item.id === model.providerID)
      return (
        !!provider?.models[model.modelID] && connected().has(model.providerID) && models.visible(model)
      )
    }

    const firstModel = (...items: Array<() => ModelKey | undefined>) => {
      for (const item of items) {
        const model = item()
        if (!model) continue
        if (validModel(model)) return model
      }
    }

    const defaultCandidates = () => {
      const onescience = providers.connected().find((item) => item.id === "onescience")
      const opencode = providers.connected().find((item) => item.id === "opencode")
      return defaultFreeModelCandidates({
        onescienceModels:
          onescience && connected().has("onescience") ? Object.keys(onescience.models) : undefined,
        opencode: opencode ? { id: opencode.id, models: Object.values(opencode.models) } : undefined,
      })
    }

    const freeModel = () => {
      for (const model of defaultCandidates()) {
        if (validModel(model)) return model
      }
    }

    const shouldKeepSavedModel = (saved: ModelKey | undefined) => {
      if (!saved) return
      if (scope()?.modelPicked) return saved
      const preferred = freeModel()
      // Leftover OneScience GPT (old implicit default) must not beat GLM, even before
      // the catalog arrives and even when the user never opened the picker.
      if (
        saved.providerID === ONESCIENCE_PROVIDER_ID &&
        saved.modelID === ONESCIENCE_GPT_MODEL_ID &&
        (!preferred || preferred.modelID === ONESCIENCE_GLM_MODEL_ID)
      ) {
        return
      }
      if (preferred && isWeakerAutomaticDefault(saved, preferred, defaultCandidates())) return
      return saved
    }

    const pickAgent = (name: string | undefined) => {
      const items = list()
      if (items.length === 0) return
      return items.find((item) => item.name === name) ?? items[0]
    }

    createEffect(() => {
      const items = list()
      if (items.length === 0) {
        if (store.current !== undefined) setStore("current", undefined)
        return
      }
      if (items.some((item) => item.name === store.current)) return
      setStore("current", items[0]?.name)
    })

    const persistKey = () => modelSelectionPersistKey(id())

    const scope = createMemo<State | undefined>(() => {
      const session = id()
      if (!session) return saved.session[persistKey()] ?? store.draft
      return saved.session[session] ?? handoff.get(handoffKey(sdk.directory, session))
    })

    createEffect(() => {
      const session = id()
      if (!session) return

      const key = handoffKey(sdk.directory, session)
      const next = handoff.get(key)
      if (!next) return
      if (saved.session[session] !== undefined) {
        handoff.delete(key)
        return
      }

      setSaved("session", session, clone(next))
      handoff.delete(key)
    })

    const configuredModel = () => {
      if (!sync.data.config.model) return
      const [providerID, modelID] = sync.data.config.model.split("/")
      const model = { providerID, modelID }
      if (validModel(model)) return model
    }

    const recentModel = () => {
      for (const item of models.recent.list()) {
        if (validModel(item)) return item
      }
    }

    const defaultModel = () => {
      const defaults = providers.default()
      for (const provider of providers.connected()) {
        const configured = defaults[provider.id]
        if (configured) {
          const model = { providerID: provider.id, modelID: configured }
          if (validModel(model)) return model
        }

        const first = Object.values(provider.models)[0]
        if (!first) continue
        const model = { providerID: provider.id, modelID: first.id }
        if (validModel(model)) return model
      }
    }

    const fallback = createMemo<ModelKey | undefined>(
      () => freeModel() ?? configuredModel() ?? recentModel() ?? defaultModel(),
    )

    const agent = {
      list,
      current() {
        return pickAgent(scope()?.agent ?? store.current)
      },
      set(name: string | undefined) {
        const item = pickAgent(name)
        if (!item) {
          setStore("current", undefined)
          return
        }

        batch(() => {
          setStore("current", item.name)
          setStore("last", {
            type: "agent",
            agent: item.name,
            model: item.model,
            variant: item.variant ?? null,
          })
          const prev = scope()
          const next = {
            agent: item.name,
            model: item.model ?? prev?.model,
            variant: item.variant ?? prev?.variant,
          } satisfies State
          const session = id()
          if (session) {
            setSaved("session", session, next)
            return
          }
          setSaved("session", persistKey(), next)
          setStore("draft", next)
        })
      },
      move(direction: 1 | -1) {
        const items = list()
        if (items.length === 0) {
          setStore("current", undefined)
          return
        }

        let next = items.findIndex((item) => item.name === agent.current()?.name) + direction
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0
        const item = items[next]
        if (!item) return
        agent.set(item.name)
      },
    }

    const current = () => {
      const item = firstModel(
        () => shouldKeepSavedModel(scope()?.model),
        () => shouldKeepSavedModel(agent.current()?.model),
        fallback,
      )
      if (item) {
        const found = models.find(item)
        if (found) return found
      }
      // Catalog not loaded yet — keep last selection / recent / config for display + send.
      if (providers.all().length === 0) {
        const fromConfig = () => {
          if (!sync.data.config.model) return
          const [providerID, modelID] = sync.data.config.model.split("/")
          if (!providerID || !modelID) return
          return { providerID, modelID } satisfies ModelKey
        }
        const key = shouldKeepSavedModel(
          scope()?.model ?? agent.current()?.model ?? models.recent.list()[0] ?? fromConfig(),
        ) ?? { providerID: ONESCIENCE_PROVIDER_ID, modelID: ONESCIENCE_GLM_MODEL_ID }
        if (!key) return
        return {
          id: key.modelID,
          name: onescienceModelDisplayName({ providerID: key.providerID, modelID: key.modelID }),
          providerID: key.providerID,
          api: { id: key.modelID, url: "", npm: "" },
          family: undefined,
          capabilities: {
            temperature: false,
            reasoning: false,
            attachment: false,
            toolcall: false,
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 0, output: 0 },
          status: "active" as const,
          options: {},
          headers: {},
          release_date: "",
          variants: undefined,
          latest: false,
          provider: {
            id: key.providerID,
            name: onescienceProviderDisplayName(key.providerID),
            source: "custom" as const,
            env: [],
            options: {},
            models: {},
          },
        }
      }
    }

    const configured = () => {
      const item = agent.current()
      const model = current()
      if (!item || !model) return
      return getConfiguredAgentVariant({
        agent: { model: item.model, variant: item.variant },
        model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
      })
    }

    const selected = () => scope()?.variant

    const snapshot = () => {
      const model = current()
      return {
        agent: agent.current()?.name,
        model: model ? { providerID: model.provider.id, modelID: model.id } : undefined,
        variant: selected(),
      } satisfies State
    }

    const write = (next: Partial<State>) => {
      const state = {
        ...(scope() ?? { agent: agent.current()?.name }),
        ...next,
      } satisfies State

      const key = persistKey()
      setSaved("session", key, state)
      if (!id()) setStore("draft", state)
    }

    // If the saved selection is hidden/unavailable, or is a weaker automatic default
    // (OneScience GPT while GLM is available), switch to the preferred default.
    createEffect(() => {
      const key = scope()?.model
      if (providers.all().length === 0) return
      const preferred = freeModel()
      if (key && validModel(key)) {
        if (scope()?.modelPicked) return
        if (!preferred || !isWeakerAutomaticDefault(key, preferred, defaultCandidates())) return
      } else if (!key) {
        if (!preferred) return
      } else if (!preferred) {
        write({ model: undefined, modelPicked: false })
        return
      }

      const next = preferred ?? firstModel(() => recentModel(), () => defaultModel())
      if (!next) {
        write({ model: undefined, modelPicked: false })
        return
      }
      if (key && next.providerID === key.providerID && next.modelID === key.modelID) return
      write({ model: next, modelPicked: false })
    })

    const recent = createMemo(() => models.recent.list().map(models.find).filter(Boolean))

    const model = {
      ready: models.ready,
      current,
      recent,
      list: models.list,
      cycle(direction: 1 | -1) {
        const items = recent()
        const item = current()
        if (!item) return

        const index = items.findIndex((entry) => entry?.provider.id === item.provider.id && entry?.id === item.id)
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0

        const entry = items[next]
        if (!entry) return
        model.set({ providerID: entry.provider.id, modelID: entry.id })
      },
      set(item: ModelKey | undefined, options?: { recent?: boolean }) {
        batch(() => {
          setStore("last", {
            type: "model",
            agent: agent.current()?.name,
            model: item ?? null,
            variant: selected(),
          })
          write({ model: item, modelPicked: true })
          if (!item) return
          models.setVisibility(item, true)
          if (!options?.recent) return
          models.recent.push(item)
        })
      },
      visible(item: ModelKey) {
        return models.visible(item)
      },
      setVisibility(item: ModelKey, visible: boolean) {
        batch(() => {
          models.setVisibility(item, visible)
          if (visible) return
          const key = scope()?.model
          if (!key || key.providerID !== item.providerID || key.modelID !== item.modelID) return
          const next = firstModel(() => freeModel(), () => recentModel(), () => defaultModel())
          if (next) write({ model: next, modelPicked: false })
          else write({ model: undefined, modelPicked: false })
        })
      },
      variant: {
        configured,
        selected,
        current() {
          const resolved = resolveModelVariant({
            variants: this.list(),
            selected: this.selected(),
            configured: this.configured(),
          })
          if (resolved) return resolved
          const model = current()
          if (!model) return
          const saved = models.variant.get({ providerID: model.provider.id, modelID: model.id })
          if (saved && this.list().includes(saved)) return saved
        },
        list() {
          const item = current()
          if (!item?.variants) return []
          return Object.keys(item.variants)
        },
        set(value: string | undefined) {
          batch(() => {
            const model = current()
            setStore("last", {
              type: "variant",
              agent: agent.current()?.name,
              model: model ? { providerID: model.provider.id, modelID: model.id } : null,
              variant: value ?? null,
            })
            write({ variant: value ?? null })
            if (model) {
              models.variant.set({ providerID: model.provider.id, modelID: model.id }, value ?? undefined)
            }
          })
        },
        cycle() {
          const items = this.list()
          if (items.length === 0) return
          this.set(
            cycleModelVariant({
              variants: items,
              selected: this.selected(),
              configured: this.configured(),
            }),
          )
        },
      },
    }

    createEffect(() => {
      if (!models.ready()) return
      const account = storedPlatformAuthSession()?.account.id
      const item = current()
      if (!account || !item) return
      const key = `onescience.submission-model:${account}`
      const value = JSON.stringify({ providerID: item.provider.id, modelID: item.id, name: item.name, variant: model.variant.current(), directory: sdk.directory })
      if (sessionStorage.getItem(key) === value) return
      sessionStorage.setItem(key, value)
      window.dispatchEvent(new Event("onescience:submission-model-changed"))
    })

    const result = {
      slug: createMemo(() => base64Encode(sdk.directory)),
      model,
      agent,
      session: {
        reset() {
          setStore("draft", undefined)
        },
        promote(dir: string, session: string) {
          const next = clone(snapshot())
          if (!next) return

          if (dir === sdk.directory) {
            setSaved("session", session, next)
            setStore("draft", undefined)
            return
          }

          handoff.set(handoffKey(dir, session), next)
          setStore("draft", undefined)
        },
        restore(msg: { sessionID: string; agent: string; model: ModelKey }) {
          const session = id()
          if (!session) return
          if (msg.sessionID !== session) return
          if (saved.session[session] !== undefined) return
          if (handoff.has(handoffKey(sdk.directory, session))) return

          setSaved("session", session, {
            agent: msg.agent,
            model: msg.model,
            variant: msg.model?.variant ?? null,
          })
        },
      },
    }
    return result
  },
})
