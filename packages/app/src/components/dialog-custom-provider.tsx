import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Link } from "@/components/link"
import { DialogSettings } from "@/components/dialog-settings"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useProviders } from "@/hooks/use-providers"
import { authTokenFromCredentials } from "@/utils/server"
import {
  deriveProviderIdentity,
  type FormState,
  headerRow,
  modelRow,
  validateCustomProvider,
} from "./dialog-custom-provider-form"
import { DialogSelectProvider } from "./dialog-select-provider"
import { reservedProviderIDs } from "@/utils/custom-provider"

type Props = {
  /** When set, open in edit mode for an existing custom provider. */
  providerID?: string
  /** Where the back button should return. Defaults by mode. */
  back?: "providers" | "models" | "select" | "picker"
  /** When set (e.g. from Models settings), scroll/focus the model ID section. */
  modelID?: string
}

type ProbeResponse = {
  ok: boolean
  kind?: "auth" | "network" | "http" | "timeout"
  message?: string
  status?: number
}

type ModelsResponse = ProbeResponse & {
  models?: string[]
}

function loadFormFromConfig(
  providerID: string,
  provider: {
    name?: string
    options?: { baseURL?: string; headers?: Record<string, string> }
    models?: Record<string, { name?: string }>
    env?: string[]
  },
  hasExistingKey = false,
): FormState {
  const models = Object.entries(provider.models ?? {})
  const headers = Object.entries(provider.options?.headers ?? {})
  const env = provider.env?.[0]
  return {
    providerID,
    name: provider.name ?? providerID,
    baseURL: provider.options?.baseURL ?? "",
    apiKey: env ? `{env:${env}}` : "",
    hasExistingKey: hasExistingKey || Boolean(env),
    // Display names always follow model IDs — do not restore distinct labels into the form.
    models: models.length
      ? models.map(([id]) => ({
          row: `m-${id}`,
          id,
          name: "",
          err: {},
        }))
      : [modelRow()],
    headers: headers.length
      ? headers.map(([key, value]) => ({ row: `h-${key}`, key, value, err: {} }))
      : [headerRow()],
    err: {},
  }
}

function loadFormFromRuntime(
  providerID: string,
  item: {
    name: string
    options?: Record<string, unknown>
    models?: Record<string, { name?: string; api?: { url?: string } }>
    env?: string[]
    key?: string
  },
): FormState {
  let baseURL = typeof item.options?.baseURL === "string" ? item.options.baseURL : ""
  // Some list payloads omit options.baseURL but still expose the relay on model.api.url.
  if (!baseURL.trim() && item.models) {
    for (const model of Object.values(item.models)) {
      const url = model?.api?.url
      if (typeof url === "string" && url.trim()) {
        baseURL = url.trim()
        break
      }
    }
  }
  const headers =
    item.options?.headers && typeof item.options.headers === "object"
      ? (item.options.headers as Record<string, string>)
      : undefined
  const hasExistingKey = Boolean(item.key?.trim() || item.env?.length)
  return loadFormFromConfig(
    providerID,
    {
      name: item.name,
      options: { baseURL, headers },
      models: item.models,
      env: item.env,
    },
    hasExistingKey,
  )
}

function emptyForm(): FormState {
  return {
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    hasExistingKey: false,
    models: [modelRow()],
    headers: [headerRow()],
    err: {},
  }
}

export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const server = useServer()
  const providers = useProviders()

  const editingID = () => props.providerID
  const editing = createMemo(() => Boolean(editingID()))
  const focusModels = createMemo(() => props.back === "models" || Boolean(props.modelID))

  const findRuntimeProvider = (id: string) =>
    globalSync.data.provider.all.find((p) => p.id === id) ??
    providers.connected().find((p) => p.id === id) ??
    providers.all().find((p) => p.id === id)

  const providerHasStoredKey = (id: string) => {
    const runtime = findRuntimeProvider(id)
    if (!runtime) return false
    return Boolean(runtime.key?.trim() || runtime.env?.length)
  }

  const mergeForms = (primary: FormState, fallback: FormState): FormState => ({
    ...primary,
    baseURL: primary.baseURL.trim() || fallback.baseURL,
    name: primary.name.trim() || fallback.name,
    apiKey: primary.apiKey.trim() || fallback.apiKey,
    hasExistingKey: Boolean(primary.hasExistingKey || fallback.hasExistingKey),
    models: primary.models.some((m) => m.id.trim()) ? primary.models : fallback.models,
    headers: primary.headers.some((h) => h.key.trim()) ? primary.headers : fallback.headers,
  })

  /** Ready to lock hydration once we have the relay URL (name alone defaults to providerID). */
  const isHydratedForm = (state: FormState) => Boolean(state.baseURL.trim())

  const resolveExistingForm = (): FormState | undefined => {
    const id = editingID()
    if (!id) return
    const hasExistingKey = providerHasStoredKey(id)
    // Touch reactive config/provider so createEffect re-runs when queries settle.
    const fromConfig = globalSync.data.config.provider?.[id]
    const fromRuntime = findRuntimeProvider(id)

    if (fromConfig) {
      const loaded = loadFormFromConfig(id, fromConfig as Parameters<typeof loadFormFromConfig>[1], hasExistingKey)
      if (fromRuntime) return mergeForms(loaded, loadFormFromRuntime(id, fromRuntime))
      return loaded
    }

    if (fromRuntime) return loadFormFromRuntime(id, fromRuntime)
  }

  const initial = resolveExistingForm()
  const [form, setForm] = createStore<FormState>(initial ?? emptyForm())
  const [hydrated, setHydrated] = createSignal(Boolean(initial && isHydratedForm(initial)))

  const applyExistingForm = (next: FormState | undefined) => {
    if (!next) return
    setForm(reconcile(next))
    if (isHydratedForm(next)) setHydrated(true)
  }

  // Config/providers may still be loading when the dialog opens (especially from shared cases).
  // Keep retrying until baseURL is present — do not lock hydration on a name-only stub.
  createEffect(() => {
    if (!editing() || hydrated()) return
    applyExistingForm(resolveExistingForm())
  })

  onMount(() => {
    void globalSync
      .ensureProviders()
      .catch(() => undefined)
      .finally(() => {
        if (!editing() || hydrated()) return
        applyExistingForm(resolveExistingForm())
      })
    if (!focusModels()) return
    requestAnimationFrame(() => {
      modelsSection?.scrollIntoView({ block: "nearest", behavior: "auto" })
    })
  })

  const focusModelIndex = createMemo(() => {
    if (!props.modelID) return 0
    const i = form.models.findIndex((m) => m.id === props.modelID)
    return i >= 0 ? i : 0
  })

  const [touchedName, setTouchedName] = createSignal(editing())
  const [discoveredModels, setDiscoveredModels] = createSignal<string[]>([])
  const [queryPending, setQueryPending] = createSignal(false)
  const [queryError, setQueryError] = createSignal<string>()

  let modelsSection: HTMLDivElement | undefined

  const selectedModelIDs = createMemo(() => new Set(form.models.map((m) => m.id.trim()).filter(Boolean)))
  const discoveredCount = createMemo(() => discoveredModels().length)
  const selectedDiscoveredCount = createMemo(
    () => discoveredModels().filter((id) => selectedModelIDs().has(id)).length,
  )

  const requestHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const current = server.current
    if (current?.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    return headers
  }

  const formExtraHeaders = () => {
    const headers: Record<string, string> = {}
    for (const row of form.headers) {
      const key = row.key.trim()
      if (!key) continue
      headers[key] = row.value
    }
    return Object.keys(headers).length ? headers : undefined
  }

  const queryApiKey = () => {
    const raw = form.apiKey.trim()
    if (!raw || raw.startsWith("{env:")) return undefined
    return raw
  }

  const goBack = () => {
    const target = props.back ?? (editing() ? "providers" : "select")
    if (target === "picker") {
      void import("./dialog-select-model").then((x) => {
        dialog.show(() => <x.DialogSelectModel />)
      })
      return
    }
    if (target === "models") {
      dialog.show(() => <DialogSettings tab="models" />)
      return
    }
    if (target === "providers") {
      dialog.show(() => <DialogSettings tab="providers" />)
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const syncIdentityFromURL = (baseURL: string) => {
    if (editing()) return
    // Only suggest a default display name from the hostname when the user has not
    // typed their own 「名称」. Provider ID is always derived from that name on save.
    if (touchedName()) return
    const derived = deriveProviderIdentity(baseURL)
    setForm("name", derived.name)
    setForm("err", "name", undefined)
  }

  const setBaseURL = (value: string) => {
    setForm("baseURL", value)
    setForm("err", "baseURL", undefined)
    syncIdentityFromURL(value)
  }

  const setName = (value: string) => {
    setTouchedName(true)
    setForm("name", value)
    setForm("err", "name", undefined)
  }

  const setApiKey = (value: string) => {
    setForm("apiKey", value)
  }

  const setModelID = (index: number, value: string) => {
    batch(() => {
      setForm("models", index, "id", value)
      setForm("models", index, "name", "")
      setForm("models", index, "err", "id", undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const toggleDiscoveredModel = (id: string) => {
    const selected = selectedModelIDs().has(id)
    if (!selected) {
      setForm(
        "models",
        produce((rows) => {
          const blank = rows.findIndex((row) => !row.id.trim())
          if (blank >= 0) {
            rows[blank].id = id
            rows[blank].name = ""
            rows[blank].err = {}
            return
          }
          const next = modelRow()
          next.id = id
          rows.push(next)
        }),
      )
      return
    }

    setForm(
      "models",
      produce((rows) => {
        const index = rows.findIndex((row) => row.id.trim() === id)
        if (index < 0) return
        if (rows.length <= 1) {
          rows[0].id = ""
          rows[0].name = ""
          rows[0].err = {}
          return
        }
        rows.splice(index, 1)
      }),
    )
  }

  const queryModels = async () => {
    if (queryPending()) return
    setQueryError(undefined)

    const baseURL = form.baseURL.trim()
    if (!baseURL || !/^https?:\/\//.test(baseURL)) {
      setQueryError(language.t("provider.custom.models.query.needURL"))
      return
    }

    const apiKey = queryApiKey()
    if (!apiKey && !editing()) {
      setQueryError(language.t("provider.custom.models.query.needKey"))
      return
    }

    setQueryPending(true)
    try {
      const response = await fetch(`${globalSDK.url}/global/provider/models`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({
          baseURL,
          apiKey,
          headers: formExtraHeaders(),
          providerID: editingID(),
        }),
      })

      const text = await response.text()
      let data: ModelsResponse | undefined
      try {
        data = text ? (JSON.parse(text) as ModelsResponse) : undefined
      } catch {
        data = undefined
      }

      if (!response.ok || !data?.ok) {
        const kind = data?.kind
        const message = data?.message
        if (kind === "auth") {
          throw new Error(message || language.t("provider.custom.error.probe.auth"))
        }
        if (kind === "timeout") {
          throw new Error(message || language.t("provider.custom.error.probe.timeout"))
        }
        if (kind === "network") {
          throw new Error(message || language.t("provider.custom.error.probe.network"))
        }
        throw new Error(message || language.t("provider.custom.error.probe.failed"))
      }

      const models = data.models ?? []
      setDiscoveredModels(models)
      if (models.length === 0) {
        setQueryError(language.t("provider.custom.models.query.empty"))
      }
    } catch (err) {
      setDiscoveredModels([])
      setQueryError(err instanceof Error ? err.message : String(err))
    } finally {
      setQueryPending(false)
    }
  }

  const validate = () => {
    if (!editing()) syncIdentityFromURL(form.baseURL)

    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: globalSync.data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(globalSync.data.provider.all.map((p) => p.id)),
      reservedProviderIDs: reservedProviderIDs(),
      editingProviderID: editingID(),
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
      if (output.result) {
        setForm("providerID", output.result.providerID)
        setForm("name", output.result.name)
      }
    })
    return output.result
  }

  async function probe(result: NonNullable<ReturnType<typeof validate>>) {
    const firstModel = Object.keys(result.config.models ?? {})[0]
    const response = await fetch(`${globalSDK.url}/global/provider/probe`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        baseURL: result.config.options?.baseURL,
        apiKey: result.key,
        headers: result.config.options?.headers,
        modelID: firstModel,
      }),
    })

    const text = await response.text()
    let data: ProbeResponse | undefined
    try {
      data = text ? (JSON.parse(text) as ProbeResponse) : undefined
    } catch {
      data = undefined
    }

    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data && data.message
          ? String(data.message)
          : language.t("provider.custom.error.probe.failed")
      throw new Error(message)
    }

    if (!data?.ok) {
      const kind = data?.kind
      const message = data?.message
      if (kind === "auth" && !result.key) return
      if (kind === "auth") {
        throw new Error(message || language.t("provider.custom.error.probe.auth"))
      }
      if (kind === "timeout") {
        throw new Error(message || language.t("provider.custom.error.probe.timeout"))
      }
      if (kind === "network") {
        throw new Error(message || language.t("provider.custom.error.probe.network"))
      }
      throw new Error(message || language.t("provider.custom.error.probe.failed"))
    }
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      await probe(result)

      const disabledProviders = globalSync.data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await globalSDK.client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await globalSync.updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
      await globalSDK.client.global.dispose()
      await globalSync.reload()
      await globalSync.ensureProviders({ force: true })
      return result
    },
    onSuccess: (result) => {
      if (props.back === "picker") {
        void import("./dialog-select-model").then((x) => {
          dialog.show(() => <x.DialogSelectModel />)
        })
      } else {
        dialog.close()
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: editing()
          ? language.t("provider.custom.toast.updated.title", { provider: result.name })
          : language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: editing()
          ? language.t("provider.custom.toast.updated.description", { provider: result.name })
          : language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">
            {editing() ? language.t("provider.custom.edit.title") : language.t("provider.custom.title")}
          </div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">{language.t("provider.custom.simple.hint")}</p>

          <div class="flex flex-col gap-4">
            <TextField
              autofocus={!editing() || (editing() && !focusModels())}
              required
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              description={language.t("provider.custom.field.baseURL.hint")}
              value={form.baseURL}
              onChange={setBaseURL}
              validationState={form.err.baseURL ? "invalid" : undefined}
              error={form.err.baseURL}
            />
            <TextField
              required={!editing()}
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={
                editing()
                  ? language.t("provider.custom.field.apiKey.keepPlaceholder")
                  : language.t("provider.custom.field.apiKey.placeholder")
              }
              description={
                editing()
                  ? language.t("provider.custom.field.apiKey.keepDescription")
                  : language.t("provider.custom.field.apiKey.hint")
              }
              value={form.apiKey}
              onChange={setApiKey}
            />
            <Show when={editing() && form.hasExistingKey}>
              <p class="text-12-regular text-text-weak -mt-2">
                {language.t("provider.custom.field.apiKey.configuredHint")}
              </p>
            </Show>
            <TextField
              label={language.t("provider.custom.field.name.label")}
              placeholder={language.t("provider.custom.field.name.placeholder")}
              description={language.t("provider.custom.field.name.hint")}
              value={form.name}
              onChange={setName}
              validationState={form.err.name ? "invalid" : undefined}
              error={form.err.name}
            />
            <Show when={editing() && form.providerID}>
              <p class="text-12-regular text-text-weak -mt-2">
                {language.t("provider.custom.field.providerID.readonly", { id: form.providerID })}
              </p>
            </Show>
          </div>

          <div ref={(el) => (modelsSection = el)} class="flex flex-col gap-3" data-section="models">
            <label class="text-12-medium text-text-weak">
              {language.t("provider.custom.models.id.label")}
              <span data-slot="input-required" aria-hidden="true">
                {" "}
                *
              </span>
            </label>
            <p class="text-12-regular text-text-weak -mt-1">{language.t("provider.custom.models.id.hint")}</p>

            <div class="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="small"
                variant="secondary"
                disabled={queryPending()}
                onClick={() => void queryModels()}
              >
                {queryPending()
                  ? language.t("provider.custom.models.query.loading")
                  : language.t("provider.custom.models.query")}
              </Button>
              <Show when={discoveredCount() > 0}>
                <span class="text-12-regular text-text-weak">
                  {language.t("provider.custom.models.query.picked", {
                    count: selectedDiscoveredCount(),
                  })}
                </span>
              </Show>
            </div>

            <Show when={queryError()}>
              <p class="text-12-regular text-text-critical-base">{queryError()}</p>
            </Show>

            <Show when={discoveredCount() > 0}>
              <div
                class="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-md border border-border-weak-base p-1.5 bg-background-base"
                role="listbox"
                aria-multiselectable="true"
                aria-label={language.t("provider.custom.models.query")}
              >
                <For each={discoveredModels()}>
                  {(id) => {
                    const selected = () => selectedModelIDs().has(id)
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected()}
                        data-selected={selected() ? "true" : undefined}
                        class="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-raised-base-hover data-[selected=true]:bg-surface-base-active"
                        onClick={() => toggleDiscoveredModel(id)}
                      >
                        <span
                          class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-weak-base text-icon-base"
                          classList={{
                            "bg-surface-raised-base border-border-strong-base": selected(),
                          }}
                          aria-hidden="true"
                        >
                          <Show when={selected()}>
                            <svg viewBox="0 0 12 12" fill="none" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
                              <path
                                d="M3 7.17905L5.02703 8.85135L9 3.5"
                                stroke="currentColor"
                                stroke-width="1.5"
                                stroke-linecap="square"
                              />
                            </svg>
                          </Show>
                        </span>
                        <span class="min-w-0 flex-1 text-13-regular text-text-strong break-all">{id}</span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>

            <For each={form.models}>
              {(m, i) => (
                <div class="flex gap-2 items-start" data-row={m.row}>
                  <div class="flex-1">
                    <TextField
                      autofocus={focusModels() && i() === focusModelIndex()}
                      required
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setModelID(i(), v)}
                      validationState={m.err.id ? "invalid" : undefined}
                      error={m.err.id}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
              {language.t("provider.custom.models.add")}
            </Button>
          </div>

          <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
            <p class="text-12-regular text-text-weak -mt-1">{language.t("provider.custom.headers.hint")}</p>
            <For each={form.headers}>
              {(h, i) => (
                <div class="flex gap-2 items-start" data-row={h.row}>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={h.key}
                      onChange={(v) => setHeader(i(), "key", v)}
                      validationState={h.err.key ? "invalid" : undefined}
                      error={h.err.key}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={h.value}
                      onChange={(v) => setHeader(i(), "value", v)}
                      validationState={h.err.value ? "invalid" : undefined}
                      error={h.err.value}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeHeader(i())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
              {language.t("provider.custom.headers.add")}
            </Button>
          </div>

          <p class="text-12-regular text-text-weak">
            {language.t("provider.custom.description.prefix")}
            <Link href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
              {language.t("provider.custom.description.link")}
            </Link>
            {language.t("provider.custom.description.suffix")}
          </p>

          <Button
            class="w-auto self-start"
            type="submit"
            size="large"
            variant="primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
