export type ProbeKind = "auth" | "network" | "http" | "timeout"

export type ProbeResult =
  | { ok: true }
  | {
      ok: false
      kind: ProbeKind
      message: string
      status?: number
    }

export type ProbeInput = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  /** Optional model id for a lightweight chat probe when /models is unavailable. */
  modelID?: string
  timeoutMs?: number
}

export type ListModelsResult =
  | { ok: true; models: string[] }
  | {
      ok: false
      kind: ProbeKind
      message: string
      status?: number
    }

function redact(text: string, apiKey?: string) {
  if (!apiKey || apiKey.length < 8) return text
  return text.split(apiKey).join(`${apiKey.slice(0, 4)}…`)
}

function modelsURL(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "")}/models`
}

function chatURL(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`
}

function isAbortError(err: unknown) {
  return err instanceof Error && err.name === "AbortError"
}

/** Parse OpenAI-compatible /models payloads into unique model ids. */
export function parseModelIDs(payload: unknown): string[] {
  const items: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (() => {
          const obj = payload as Record<string, unknown>
          if (Array.isArray(obj.data)) return obj.data
          if (Array.isArray(obj.models)) return obj.models
          return []
        })()
      : []

  const ids: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const id =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
          ? (item as { id: string }).id.trim()
          : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * Probe an OpenAI-compatible endpoint before saving custom provider config.
 * Prefer `/models`; fall back to a tiny chat completion when that route is missing.
 */
export async function probeCustomProvider(input: ProbeInput): Promise<ProbeResult> {
  const timeoutMs = input.timeoutMs ?? 8_000
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(input.headers ?? {}),
  }
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const modelsRes = await fetch(modelsURL(input.baseURL), {
      method: "GET",
      headers,
      signal: controller.signal,
    })

    if (modelsRes.status === 401 || modelsRes.status === 403) {
      const body = await modelsRes.text().catch(() => "")
      return {
        ok: false,
        kind: "auth",
        status: modelsRes.status,
        message: redact(
          body
            ? `Authentication failed (HTTP ${modelsRes.status}): ${body.slice(0, 200)}`
            : `Authentication failed (HTTP ${modelsRes.status})`,
          input.apiKey,
        ),
      }
    }

    if (modelsRes.ok) return { ok: true }

    // Some gateways omit /models; try a minimal chat call when we have a model id.
    if (input.modelID && (modelsRes.status === 404 || modelsRes.status === 405)) {
      const chatRes = await fetch(chatURL(input.baseURL), {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.modelID,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      })

      if (chatRes.status === 401 || chatRes.status === 403) {
        const body = await chatRes.text().catch(() => "")
        return {
          ok: false,
          kind: "auth",
          status: chatRes.status,
          message: redact(
            body
              ? `Authentication failed (HTTP ${chatRes.status}): ${body.slice(0, 200)}`
              : `Authentication failed (HTTP ${chatRes.status})`,
            input.apiKey,
          ),
        }
      }

      if (chatRes.ok || chatRes.status === 400) {
        // 400 often means the probe payload was rejected but the endpoint is reachable/authenticated.
        return { ok: true }
      }

      const body = await chatRes.text().catch(() => "")
      return {
        ok: false,
        kind: "http",
        status: chatRes.status,
        message: redact(
          body
            ? `Request failed (HTTP ${chatRes.status}): ${body.slice(0, 200)}`
            : `Request failed (HTTP ${chatRes.status})`,
          input.apiKey,
        ),
      }
    }

    const body = await modelsRes.text().catch(() => "")
    return {
      ok: false,
      kind: "http",
      status: modelsRes.status,
      message: redact(
        body
          ? `Base URL returned HTTP ${modelsRes.status}: ${body.slice(0, 200)}`
          : `Base URL returned HTTP ${modelsRes.status}`,
        input.apiKey,
      ),
    }
  } catch (err) {
    if (isAbortError(err)) {
      return {
        ok: false,
        kind: "timeout",
        message: "Connection timed out. Check the Base URL and network.",
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      kind: "network",
      message: redact(`Could not reach Base URL: ${message}`, input.apiKey),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * List models from an OpenAI-compatible `/models` endpoint.
 * Unlike probe, this requires a successful `/models` response (no chat fallback).
 */
export async function listCustomProviderModels(input: ProbeInput): Promise<ListModelsResult> {
  const timeoutMs = input.timeoutMs ?? 8_000
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(input.headers ?? {}),
  }
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const modelsRes = await fetch(modelsURL(input.baseURL), {
      method: "GET",
      headers,
      signal: controller.signal,
    })

    if (modelsRes.status === 401 || modelsRes.status === 403) {
      const body = await modelsRes.text().catch(() => "")
      return {
        ok: false,
        kind: "auth",
        status: modelsRes.status,
        message: redact(
          body
            ? `Authentication failed (HTTP ${modelsRes.status}): ${body.slice(0, 200)}`
            : `Authentication failed (HTTP ${modelsRes.status})`,
          input.apiKey,
        ),
      }
    }

    if (!modelsRes.ok) {
      const body = await modelsRes.text().catch(() => "")
      return {
        ok: false,
        kind: "http",
        status: modelsRes.status,
        message: redact(
          body
            ? `Models endpoint returned HTTP ${modelsRes.status}: ${body.slice(0, 200)}`
            : `Models endpoint returned HTTP ${modelsRes.status}`,
          input.apiKey,
        ),
      }
    }

    const json = (await modelsRes.json().catch(() => undefined)) as unknown
    return { ok: true, models: parseModelIDs(json) }
  } catch (err) {
    if (isAbortError(err)) {
      return {
        ok: false,
        kind: "timeout",
        message: "Connection timed out. Check the Base URL and network.",
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      kind: "network",
      message: redact(`Could not reach Base URL: ${message}`, input.apiKey),
    }
  } finally {
    clearTimeout(timer)
  }
}
