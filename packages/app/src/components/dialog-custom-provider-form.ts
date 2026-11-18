const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  /** True when an existing key is already stored for this provider (env or api). Not the key value. */
  hasExistingKey?: boolean
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  /** Builtin / branded ids that custom relays must never claim. */
  reservedProviderIDs?: Set<string>
  /** When editing an existing custom provider, allow the same provider ID. */
  editingProviderID?: string
}

/** Derive a stable provider id from the user-facing display name (名称). */
export function deriveProviderIDFromName(name: string): string {
  let providerID = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!providerID || !/^[a-z0-9]/.test(providerID)) providerID = `p-${providerID || "custom"}`
  return providerID.slice(0, 48)
}

/** Derive a stable provider id + display name from a Base URL hostname (legacy fallback). */
export function deriveProviderIdentity(baseURL: string): { providerID: string; name: string } {
  const trimmed = baseURL.trim()
  let host = ""
  try {
    host = new URL(trimmed).hostname
  } catch {
    host = trimmed.replace(/^https?:\/\//, "").split("/")[0] ?? ""
  }

  const label = host || "custom"
  return { providerID: deriveProviderIDFromName(label.split(".")[0] || label), name: label }
}

/** Ensure providerID is unique against an existing set (append -2, -3, …). */
export function uniqueProviderID(base: string, existing: Set<string>, allow?: string) {
  if (allow && base === allow) return base
  if (!existing.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const next = `${base}-${i}`
    if (!existing.has(next) || next === allow) return next
  }
  return `${base}-${Date.now().toString(36)}`
}

export function validateCustomProvider(input: ValidateArgs) {
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()
  const derived = deriveProviderIdentity(baseURL)
  const editing = Boolean(input.editingProviderID)

  let name = input.form.name.trim()
  let providerID = input.form.providerID.trim()
  if (!editing) {
    // 「名称」is the user-visible identity — slug it into providerID so the list
    // shows hmk_1 instead of the relay hostname (rehdasu.cn).
    // Never claim a builtin id (e.g. deepseek) even when that official provider is disabled.
    const reserved = input.reservedProviderIDs ?? new Set<string>()
    const taken = new Set([...input.existingProviderIDs, ...reserved])
    const nameWasEmpty = !name
    if (!name) name = derived.name
    const fromName = nameWasEmpty ? derived.providerID : deriveProviderIDFromName(name)
    const disabledBase = input.disabledProviders.includes(fromName) && !reserved.has(fromName)
    providerID =
      disabledBase || !taken.has(fromName) ? fromName : uniqueProviderID(fromName, taken)
  }

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const sameEdit = Boolean(input.editingProviderID && input.editingProviderID === providerID)
  const existsError = idError
    ? undefined
    : !sameEdit && input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const models = input.form.models.map((m) => {
    const id = m.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    // Display name is optional — falls back to model id.
    return { id: idError, name: undefined as string | undefined }
  })
  const modelsValid = models.every((m) => !m.id)
    // Display name always matches model ID — no separate label field.
    const modelConfig = Object.fromEntries(
      input.form.models.map((m) => {
        const id = m.id.trim()
        return [id, { name: id }]
      }),
    )

  const seenHeaders = new Set<string>()
  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelRow = (): ModelRow => ({ row: nextRow(), id: "", name: "", err: {} })
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })
