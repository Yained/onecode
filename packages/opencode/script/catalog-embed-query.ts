#!/usr/bin/env bun
process.env.CATALOG_EMBED_WORKER ??= "1"
import { CatalogEmbedding } from "@/catalog/embedding"

type EmbedPayload = {
  id?: string
  texts?: string[]
  query?: boolean
  modelId?: string
  ping?: boolean
}

async function embedTexts(payload: EmbedPayload) {
  const texts = payload.texts ?? []
  if (texts.length === 0) return [] as number[][]
  const model = CatalogEmbedding.resolveEmbedModel("model")
  if (!model || model.mode !== "model") throw new Error("catalog model embedding unavailable")
  return CatalogEmbedding.embedTextsAsync(texts, model, { query: payload.query })
}

async function warmupModel() {
  await embedTexts({ texts: ["catalog embedding warmup"] })
}

async function runDaemon() {
  await warmupModel()
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`)

  const reader = Bun.stdin.stream().getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) await handleDaemonLine(line)
      newline = buffer.indexOf("\n")
    }
  }
}

async function handleDaemonLine(line: string) {
  const payload = JSON.parse(line) as EmbedPayload
  if (payload.ping) {
    process.stdout.write(`${JSON.stringify({ pong: true, id: payload.id })}\n`)
    return
  }
  const id = payload.id
  if (!id) return
  try {
    const vectors = await embedTexts(payload)
    process.stdout.write(`${JSON.stringify({ id, vectors })}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify({ id, error: message })}\n`)
  }
}

async function runOnce() {
  const payload = JSON.parse(await Bun.stdin.text()) as EmbedPayload
  const vectors = await embedTexts(payload)
  console.log(JSON.stringify(vectors))
}

if (process.argv.includes("--daemon")) {
  await runDaemon()
} else {
  await runOnce()
}
